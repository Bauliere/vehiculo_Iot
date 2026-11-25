import { commandLabel } from '../domain/catalog.js';
import { action, group, icon, node, notice, paging } from './commercial-ui.js';

const PAGE_SIZE = 12;
const LOAD_TRUCK_PHOTO = new URL('../../images/maquina-de-carga.png', import.meta.url).href;

export class Showroom {
  constructor(document, api, { onStart, onEnd }) {
    Object.assign(this, { document, api, onStart, onEnd });
    this.models = document.getElementById('showroom-models');
    this.clock = document.getElementById('exhibition-timer');
    this.message = document.getElementById('showroom-notice');
    this.offset = 0;
    this.session = null;
    this.loading = null;
  }

  async load(done = '') {
    this.loading?.abort();
    const job = new AbortController();
    this.loading = job;
    if (!done) notice(this.message, 'Consultando catálogo…');
    this.models.setAttribute('aria-busy', 'true');
    try {
      const rows = await this.api.request(`/plataforma/catalogo?limit=${PAGE_SIZE}&offset=${this.offset}`, { signal: job.signal });
      if (job.signal.aborted) return;
      this.models.replaceChildren(...rows.map(model => this.model(model)), paging(rows, this.offset, PAGE_SIZE, offset => {
        this.offset = offset;
        void this.load().then(() => this.document.getElementById('showroom-heading').focus({ preventScroll: true }));
      }));
      notice(this.message, done || (!rows.length ? 'Por ahora no hay modelos en el catálogo.' : ''));
    } catch (error) {
      if (job.signal.aborted) return;
      this.models.replaceChildren();
      notice(this.message, error.status === 404 ? 'El catálogo aún no está habilitado en el servidor.' : error.message, true);
      this.models.append(action('Reintentar catálogo', () => void this.load()));
    } finally {
      if (this.loading === job) this.models.removeAttribute('aria-busy');
    }
  }

  model(model) {
    const article = node('article', '', 'glass-panel commercial-panel');
    article.setAttribute('data-tilt-card', '');
    const foil = group('monitor-foil', node('i'), node('i'), node('i'), node('i'));
    foil.setAttribute('aria-hidden', 'true');
    article.append(foil);
    const heading = group('showroom-card-title', icon('catalog'), node('h2', model.nombre));
    article.append(heading);
    const photoUrl = model.foto_url?.startsWith('https://') ? model.foto_url
      : model.id_modelo === 1 ? LOAD_TRUCK_PHOTO : null;
    if (photoUrl) {
      const photo = node('img', '', 'showroom-photo');
      const frame = group('showroom-photo-frame', photo);
      if (model.id_modelo === 1) {
        const effect = node('div', '', 'showroom-photo-effect');
        effect.setAttribute('aria-hidden', 'true');
        frame.prepend(foil);
        frame.append(effect);
      }
      photo.alt = model.nombre;
      photo.loading = 'lazy';
      photo.decoding = 'async';
      photo.referrerPolicy = 'no-referrer';
      photo.addEventListener('error', () => {
        if (frame.contains(foil)) article.prepend(foil);
        frame.remove();
      }, { once: true });
      photo.src = photoUrl;
      article.append(frame);
    }
    if (model.descripcion) article.append(node('p', model.descripcion));
    if (model.capacidades.length) article.append(node('p', model.capacidades.map(item => commandLabel(item.nombre)).join(' · '), 'commercial-muted'));
    const list = node('ul', '', 'showroom-units');
    for (const unit of model.unidades) {
      const item = node('li');
      item.append(node('span', unit.nombre));
      if (unit.disponible) {
        const reserve = action('Reservar prueba', () => void this.reserve(unit), { primary: true });
        reserve.dataset.reserve = '';
        reserve.disabled = Boolean(this.session || this.reserving || this.api.hasKey());
        item.append(reserve);
      } else item.append(node('span', unit.ocupada ? 'Ocupada' : 'Sin disponibilidad', 'commercial-muted'));
      list.append(item);
    }
    article.append(list.childElementCount ? list : node('p', 'Sin unidades de exhibición disponibles.', 'commercial-muted'));
    return article;
  }

  toggleReservations() {
    for (const button of this.models.querySelectorAll('[data-reserve]')) {
      button.disabled = Boolean(this.session || this.reserving || this.api.hasKey());
    }
  }

  async reserve(unit) {
    if (this.session || this.reserving || this.api.hasKey()) return;
    this.reserving = true;
    this.toggleReservations();
    notice(this.message, 'Reservando unidad…');
    try {
      const data = await this.api.request(`/plataforma/exhibicion/${unit.id_vehiculo}/sesiones`, { method: 'POST' });
      this.session = { ...data };
      notice(this.message, '');
      this.onStart(unit, this.session);
      this.session.timer = setInterval(() => this.tick(), 200);
      this.tick();
    } catch (error) {
      notice(this.message, error.message, true);
    } finally {
      this.reserving = false;
      this.toggleReservations();
    }
  }

  tick() {
    const session = this.session;
    if (!session) return;
    const remaining = Math.max(0, Math.ceil((Date.parse(session.vence) - Date.now()) / 1000));
    const text = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
    if (this.clock.textContent !== text) this.clock.textContent = text;
    if (!remaining) void this.finish('Se agotó el tiempo de la prueba.');
  }

  async finish(reason = '', leaving = false) {
    const session = this.session;
    if (!session) return;
    this.session = null;
    this.reserving = true;
    clearInterval(session.timer);
    this.onEnd(leaving);
    let message = reason;
    try {
      await this.api.request('/plataforma/exhibicion/sesion', { method: 'DELETE', bearerToken: session.token, keepalive: leaving });
    } catch (error) {
      if (error.status !== 401) message = 'La detención se está comprobando en el servidor.';
    } finally {
      this.reserving = false;
      if (!leaving) {
        this.document.getElementById('showroom-heading').focus({ preventScroll: true });
        await this.load(message);
      }
    }
  }
}
