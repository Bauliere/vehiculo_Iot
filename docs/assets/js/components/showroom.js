import { commandLabel } from '../domain/catalog.js';
import { action, group, icon, node, notice, paging } from './commercial-ui.js';
import { bindHoldGesture, HOLD_ACTION_MS } from './hold-gesture.js';

const PAGE_SIZE = 12;
const LOAD_TRUCK_PHOTO = new URL('../../images/maquina-de-carga.png', import.meta.url).href;

export class Showroom {
  constructor(document, api, openSocket) {
    Object.assign(this, { document, api, openSocket });
    this.models = document.getElementById('showroom-models');
    this.activity = document.getElementById('exhibition-session');
    this.actions = document.getElementById('exhibition-actions');
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
      const session = { ...data, channel: '', ready: false, connected: false, sending: false };
      this.session = session;
      this.activity.hidden = false;
      this.document.getElementById('exhibition-title').textContent = `Prueba · ${unit.nombre}`;
      notice(this.message, 'Conectando con la unidad…');
      this.render();
      this.document.getElementById('exhibition-title').focus();
      session.socket = this.openSocket(unit.id_vehiculo, data.token, {
        onStatus: status => {
          if (this.session !== session) return;
          if (status !== 'connected' && session.ready) queueMicrotask(() => {
            if (this.session === session) void this.finish('Se perdió la conexión. La prueba terminó.');
          });
        },
        onPolicy: () => void this.finish('La reserva de invitado terminó.'),
        onEvent: event => {
          if (this.session !== session) return;
          if (event.tipo === 'canal_control') {
            session.channel = event.canal;
            session.ready = true;
            session.connected = event.dispositivo === true;
            notice(this.message, session.connected ? '' : 'El dispositivo se desconectó.', !session.connected);
            this.syncButtons();
          } else if (event.tipo === 'dispositivo' && !event.conectado) {
            void this.finish('El dispositivo se desconectó. La prueba terminó.');
          }
        },
      });
      session.timer = setInterval(() => this.tick(), 200);
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

  render() {
    const session = this.session;
    const commands = session.comandos.map(command => {
      const stop = command.nombre === 'DETENER';
      const button = action(stop ? 'Detener' : commandLabel(command.nombre), () => void this.move(command), { primary: !stop });
      button.dataset.guestCommand = stop ? 'stop' : 'move';
      return button;
    });
    const end = action('Terminar sesión ahora', null);
    end.classList.add('commercial-hold');
    end.setAttribute('data-cursor-target', '');
    end.setAttribute('aria-describedby', 'end-guest-hint');
    const hint = node('small', 'Mantén presionado para devolver el mando.', 'commercial-muted');
    hint.id = 'end-guest-hint';
    session.removeHold = bindHoldGesture(end, HOLD_ACTION_MS, () => void this.finish('Prueba finalizada.'));
    this.actions.replaceChildren(...commands, end, hint);
    this.syncButtons();
  }

  syncButtons() {
    const session = this.session;
    for (const button of this.actions.querySelectorAll('[data-guest-command]')) {
      button.disabled = !session?.ready || (!session.connected && button.dataset.guestCommand !== 'stop')
        || (button.dataset.guestCommand === 'move' && (session.sending || session.cooling));
    }
  }

  async move(command) {
    const session = this.session;
    if (!session?.ready) return;
    const stop = command.nombre === 'DETENER';
    if (!stop) { session.sending = true; this.syncButtons(); }
    try {
      await this.api.request('/plataforma/exhibicion/ordenes', { method: 'POST', body: { id_comando: command.id_comando },
        bearerToken: session.token, channelId: session.channel });
      if (this.session === session) notice(this.message, stop ? 'La API registró DETENER.' : 'La API registró la orden.');
    } catch (error) {
      if (this.session === session) notice(this.message, error.message, true);
    } finally {
      if (!stop && this.session === session) {
        session.sending = false;
        session.cooling = setTimeout(() => { session.cooling = null; this.syncButtons(); }, 1250);
        this.syncButtons();
      }
    }
  }

  async finish(reason = '', leaving = false) {
    const session = this.session;
    if (!session) return;
    this.session = null;
    this.reserving = true;
    clearInterval(session.timer);
    clearTimeout(session.cooling);
    session.removeHold?.();
    this.activity.hidden = true;
    this.actions.replaceChildren();
    let message = reason;
    try {
      if (leaving) session.socket?.stop();
      await this.api.request('/plataforma/exhibicion/sesion', { method: 'DELETE', bearerToken: session.token, keepalive: leaving });
    } catch (error) {
      if (error.status !== 401) message = 'La detención se está comprobando en el servidor.';
    } finally {
      session.socket?.stop();
      this.reserving = false;
      if (!leaving) {
        this.document.getElementById('showroom-heading').focus({ preventScroll: true });
        await this.load(message);
      }
    }
  }
}
