import { action, field, group, node, notice, paging, table } from './commercial-ui.js';
import { customerForm, demoForm, modelForm, STATUSES, unitForm } from './commercial-forms.js';

const ADMIN_SECTIONS = { summary: 'Resumen', models: 'Modelos', units: 'Unidades', customers: 'Clientes', demos: 'Demostraciones', audit: 'Auditoría' };
const BUYER_SECTIONS = { own: 'Mis vehículos', demos: 'Mis demostraciones' };
const STATES = Object.fromEntries(STATUSES);
const METRICS = { modelos: 'Modelos activos', unidades: 'Unidades registradas', asignadas: 'Unidades asignadas',
  exhibicion_disponible: 'Disponibles para prueba', clientes: 'Clientes activos', demos: 'Demostraciones activas',
  conectadas: 'Dispositivos conectados', reservas: 'Reservas abiertas' };
const PAGE_SIZE = 25;
const time = new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Mexico_City' });
const integer = new Intl.NumberFormat('es-MX');
const p = (text, soft = false) => node('p', text, soft ? 'commercial-muted' : '');

export class CommercialView {
  constructor(document, api, { onSelect, onUnitChange, onExpired, onDemosChange }) {
    Object.assign(this, { document, api, onSelect, onUnitChange, onExpired, onDemosChange });
    this.menu = document.getElementById('commercial-menu');
    this.title = document.getElementById('commercial-section-title');
    this.content = document.getElementById('commercial-content');
    this.toolbar = document.getElementById('commercial-actions');
    this.message = document.getElementById('commercial-notice');
    this.operation = null;
    this.account = null;
  }

  setAccount(account) {
    this.cancel();
    this.account = account;
    this.unit = null;
    this.sections = account?.rol === 'administrador' ? ADMIN_SECTIONS : BUYER_SECTIONS;
    this.section = Object.keys(this.sections)[0];
    this.filters = { q: '', estado: '', offset: 0 };
    this.clear();
    this.menu.replaceChildren();
    this.document.getElementById('commercial-heading').textContent = account?.rol === 'administrador' ? 'Administración' : 'Mis vehículos';
    this.document.getElementById('commercial-identity').textContent = account?.nombre ?? '';
    if (!account) return;
    for (const [id, title] of Object.entries(this.sections)) {
      const button = node('button', title);
      button.type = 'button';
      button.dataset.section = id;
      button.addEventListener('click', () => void this.open(id, { reset: this.section !== id }));
      this.menu.append(button);
    }
  }

  cancel() { this.operation?.abort(); }

  clear() {
    this.toolbar.replaceChildren();
    this.content.replaceChildren();
    notice(this.message, '');
  }

  async run(render) {
    this.cancel();
    const job = new AbortController();
    this.operation = job;
    const read = (path, options) => this.api.request(`/plataforma${path}`, { ...options, signal: job.signal });
    notice(this.message, 'Cargando…');
    this.content.setAttribute('aria-busy', 'true');
    try {
      const output = await render(read);
      if (job.signal.aborted) return;
      notice(this.message, '');
      output?.();
    } catch (error) {
      if (job.signal.aborted) return;
      this.fail(error);
    } finally {
      if (this.operation === job) this.content.removeAttribute('aria-busy');
    }
  }

  fail(error) {
    if (error.status === 401) this.onExpired();
    else notice(this.message, error.message, true);
  }

  async all(read, path) {
    const rows = [];
    let page;
    do {
      page = await read(`${path}?limit=100&offset=${rows.length}`);
      rows.push(...page);
    } while (page.length === 100);
    return rows;
  }

  async open(section = this.section, { reset = false, done = '' } = {}) {
    if (!this.account || !this.sections[section]) return;
    if (reset) this.filters = { q: '', estado: '', offset: 0 };
    this.section = section;
    this.clear();
    for (const button of this.menu.children) {
      if (button.dataset.section === section) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    this.title.textContent = this.sections[section];
    await this.run(async read => {
      const render = await this[section](read);
      return () => { render(); if (done) notice(this.message, done); };
    });
  }

  async summary(read) {
    const [stats, units, log] = await Promise.all([read('/dashboard'), read('/unidades?limit=4'), read('/auditoria?limit=4')]);
    return () => {
      const metrics = node('dl', '', 'commercial-metrics');
      for (const [key, title] of Object.entries(METRICS)) {
        metrics.append(group('', node('dt', title), node('dd', Number.isFinite(stats[key]) ? integer.format(stats[key]) : 'Sin datos')));
      }
      const inventory = node('section');
      inventory.append(node('h3', 'Inventario'), units.length ? table(['Unidad', 'Estado'], units.map(unit => [unit.nombre,
        STATES[unit.estado_comercial] ?? 'Por clasificar'])) : p('Todavía no hay unidades.', true),
      group('commercial-paging', action('Ver unidades', () => void this.open('units', { reset: true }))));
      const activity = node('section');
      activity.append(node('h3', 'Actividad reciente'), log.length ? table(['Acción', 'Fecha'], log.map(entry => [this.auditAction(entry.accion), time.format(new Date(entry.fecha))]))
        : p('Aún no hay acciones registradas.', true));
      this.content.append(metrics, group('commercial-widgets mt-4', inventory, activity));
    };
  }

  searchFilter(withStates = false) {
    const form = node('form', '', 'commercial-search');
    const search = field('q', 'Buscar', { value: this.filters.q, maxLength: 254, type: 'search', enterKeyHint: 'search' });
    form.append(search);
    if (withStates) form.append(field('estado', 'Estado', { value: this.filters.estado, options: [['', 'Todos'], ...STATUSES] }));
    const submit = action('Filtrar', null, { primary: true });
    submit.type = 'submit';
    form.append(submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(form);
      this.filters = { q: data.get('q').trim(), estado: data.get('estado') ?? '', offset: 0 };
      void this.open().then(() => this.content.querySelector('[name="q"]')?.focus({ preventScroll: true }));
    });
    return form;
  }

  async rows(read, path) {
    const { q, estado, offset } = this.filters;
    const query = new URLSearchParams({ limit: PAGE_SIZE, offset });
    if (q && path !== '/auditoria') query.set('q', q);
    if (estado && path === '/unidades') query.set('estado', estado);
    return read(`${path}?${query}`);
  }

  listing(results, headers, cells, empty) {
    this.content.append(results.length ? table(headers, cells) : p(empty, true),
      paging(results, this.filters.offset, PAGE_SIZE, offset => {
        this.filters.offset = offset;
        void this.open().then(() => this.title.focus({ preventScroll: true }));
      }));
  }

  async models(read) {
    const rows = await this.rows(read, '/modelos');
    return () => {
      this.toolbar.append(action('Nuevo modelo', () => this.editModel(), { primary: true }));
      this.content.append(this.searchFilter());
      this.listing(rows, ['Modelo', 'Estado', ''], rows.map(row => [group('', p(row.nombre), ...(row.descripcion ? [p(row.descripcion, true)] : [])),
        row.activo ? 'Activo' : 'Inactivo', group('commercial-actions', action('Editar', () => this.editModel(row.id_modelo)))]), 'No hay modelos en esta búsqueda.');
    };
  }

  editModel(id) {
    void this.run(async read => {
      const row = id ? await read(`/modelos/${id}`) : {};
      return () => this.form(id ? 'Editar modelo' : 'Nuevo modelo', modelForm(row), '/modelos', id, 'Modelo guardado.');
    });
  }

  async units(read) {
    const rows = await this.rows(read, '/unidades');
    return () => {
      this.toolbar.append(action('Nueva unidad', () => this.editUnit(), { primary: true }));
      this.content.append(this.searchFilter(true));
      this.listing(rows, ['Unidad / serie', 'Modelo', 'Estado', 'Propietario', 'Dispositivo', ''], rows.map(row => [
        group('', p(row.nombre), p(row.identificador_fisico ?? `Unidad ${row.id_vehiculo} · Sin serie`, true)), row.nombre_modelo ?? 'Sin modelo',
        STATES[row.estado_comercial] ?? 'Por clasificar', row.propietario ?? 'Sin asignar', row.dispositivo ? 'Conectado' : 'Sin conexión autenticada',
        group('commercial-actions', action('Editar', () => this.editUnit(row)), ...(['vendida', 'disponible'].includes(row.estado_comercial)
          ? [action('Asignación', () => this.editAssignment(row))] : [])),
      ]), 'No hay unidades en esta búsqueda.');
    };
  }

  editUnit(row = {}) {
    void this.run(async read => {
      const models = await this.all(read, '/modelos');
      return () => {
        if (!models.length) { notice(this.message, 'Registra un modelo antes de dar de alta una unidad.', true); return; }
        this.form(row.id_vehiculo ? 'Editar unidad' : 'Nueva unidad', unitForm(row, models), '/unidades', row.id_vehiculo, 'Unidad guardada.', this.onUnitChange);
      };
    });
  }

  editAssignment(row) {
    void this.run(async read => {
      const customers = await this.all(read, '/clientes');
      const options = [['', 'Sin propietario'], ...customers.filter(c => c.activo || c.id_cliente === row.id_cliente)
        .map(c => [c.id_cliente, `${c.nombre} · ${c.correo}`])];
      return () => this.form('Asignación de unidad', {
        fields: [p(row.nombre), field('id_cliente', 'Comprador', { value: row.id_cliente, options }),
          p('Si cambias de comprador, el titular anterior pierde el acceso a esta unidad.', true)],
        payload: data => ({ id_cliente: Number(data.get('id_cliente')) || null }),
      }, `/unidades/${row.id_vehiculo}/asignacion`, null, 'Asignación guardada.', this.onUnitChange, 'PUT');
    });
  }

  async customers(read) {
    const rows = await this.rows(read, '/clientes');
    return () => {
      this.toolbar.append(action('Nuevo cliente', () => this.editCustomer(), { primary: true }));
      this.content.append(this.searchFilter());
      this.listing(rows, ['Cliente', 'Correo', 'Estado', ''], rows.map(row => [row.nombre, row.correo, row.activo ? 'Activo' : 'Inactivo',
        group('commercial-actions', action('Editar', () => this.editCustomer(row)))]), 'No hay clientes en esta búsqueda.');
    };
  }

  editCustomer(row = {}) {
    this.form(row.id_cliente ? 'Editar cliente' : 'Nuevo cliente', customerForm(row), '/clientes', row.id_cliente, 'Cliente guardado.');
  }

  async own(read) {
    const units = await this.rows(read, '/mis-unidades');
    return () => {
      this.listing(units, ['Unidad', 'Modelo', 'Soporte', ''], units.map(row => [row.nombre, row.nombre_modelo ?? 'Sin modelo',
        row.soporte_hasta && Date.parse(row.soporte_hasta) > Date.now() ? `Hasta ${time.format(new Date(row.soporte_hasta))}` : 'Sin autorización',
        group('commercial-actions', action('Controlar', () => this.onSelect(row.id_vehiculo), { primary: true }),
          action(row.soporte_hasta && Date.parse(row.soporte_hasta) > Date.now() ? 'Revocar soporte' : 'Autorizar soporte',
            () => this.editSupport(row)))]), 'Todavía no tienes unidades asignadas.');
    };
  }

  editSupport(row) {
    const revoke = row.soporte_hasta && Date.parse(row.soporte_hasta) > Date.now();
    this.form(revoke ? 'Revocar soporte' : 'Autorizar soporte', {
      fields: [p(row.nombre), p(revoke ? 'La empresa perderá el acceso remoto a esta unidad.'
        : 'La empresa podrá consultar y operar esta unidad durante 15 minutos.')],
      payload: () => ({ autorizado: !revoke }),
    }, `/unidades/${row.id_vehiculo}/soporte`, null, revoke ? 'Soporte revocado.' : 'Soporte autorizado durante 15 minutos.', this.onUnitChange, 'PUT');
  }

  async demos(read) {
    const units = await this.all(read, this.account.rol === 'administrador' ? '/unidades' : '/mis-unidades');
    const id = units.some(unit => unit.id_vehiculo === this.unit) ? this.unit : units[0]?.id_vehiculo;
    const data = id ? await read(`/unidades/${id}/editor`) : null;
    return () => {
      this.unit = id;
      if (!data) { this.content.append(p('Las demostraciones requieren una unidad registrada o asignada.', true)); return; }
      const selector = field('unidad_demo', 'Unidad', { value: id, options: units.map(unit => [unit.id_vehiculo, unit.nombre]) });
      selector.addEventListener('change', event => { this.unit = Number(event.target.value); void this.open().then(() => this.content.querySelector('select')?.focus()); });
      const owned = data.demos.filter(demo => this.account.rol === 'administrador' ? demo.id_cliente_demo === null : demo.id_cliente_demo === this.account.id_cliente);
      this.toolbar.append(action('Nueva demostración', () => this.editDemo(id, data), { primary: true }));
      this.content.append(group('commercial-search', selector), owned.length ? table(['Recorrido', 'Estado', ''], owned.map(row => [row.nombre,
        row.activo ? 'Activo' : 'Inactivo', group('commercial-actions', action('Editar', () => this.editDemo(id, data, row.id_demo)))]))
        : p('Todavía no hay demostraciones para editar en esta unidad.', true));
    };
  }

  editDemo(id, data, demoId) {
    if (!data.comandos.length) { notice(this.message, 'Configura las capacidades de esta unidad antes de crear pasos.', true); return; }
    void this.run(async read => {
      const path = `/unidades/${id}/editor`;
      const row = demoId ? await read(`${path}/${demoId}`) : {};
      return () => this.form(demoId ? 'Editar demostración' : 'Nueva demostración', demoForm(row, data.comandos), path,
        demoId, 'Demostración guardada.', () => this.onDemosChange(id));
    });
  }

  auditAction(value) { return value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase()); }

  async audit(read) {
    const rows = await this.rows(read, '/auditoria');
    return () => this.listing(rows, ['Fecha (CDMX)', 'Actor', 'Acción', 'Recurso', 'Resultado'], rows.map(row => [time.format(new Date(row.fecha)),
      row.actor ?? this.auditAction(row.rol), this.auditAction(row.accion), row.id_recurso ? `${row.recurso} ${row.id_recurso}` : row.recurso,
      this.auditAction(row.resultado)]), 'Aún no hay acciones registradas.');
  }

  form(title, { fields, payload }, path, id, success, complete = () => {}, method = id ? 'PUT' : 'POST') {
    this.clear();
    this.title.textContent = title;
    const form = node('form', '', 'commercial-form');
    const save = action('Guardar', null, { primary: true });
    save.type = 'submit';
    const cancel = action('Cancelar', () => void this.open());
    form.append(...fields, group('commercial-actions', save, cancel));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const body = payload(new FormData(form));
      save.disabled = true;
      cancel.disabled = true;
      notice(this.message, 'Guardando…');
      try {
        await this.api.request(`/plataforma${path}${id ? `/${id}` : ''}`, { method, body });
        await complete();
        if (form.isConnected) await this.open(this.section, { done: success });
      } catch (error) {
        if (form.isConnected) this.fail(error);
      } finally { save.disabled = false; cancel.disabled = false; }
    });
    this.content.append(form);
    this.title.focus({ preventScroll: true });
  }
}
