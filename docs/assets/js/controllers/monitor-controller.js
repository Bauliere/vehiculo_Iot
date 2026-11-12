import { normalizeState, normalizeHistory, normalizeEvent } from '../domain/monitor-data.js';

/** Lectura compartida por las dos vistas. WSS avisa; REST confirma el historial.
 * Una sola consulta por recurso, sin sondeo periódico ni escrituras de monitoreo. */
export class MonitorController {
  constructor(api, vehicleId, { onChange = () => {}, debounceMs = 140 } = {}) {
    Object.assign(this, { api, vehicleId, onChange, debounceMs });
    this.value = { latest: null, records: [], stateStatus: 'idle', historyStatus: 'idle',
      stateError: '', historyError: '', socket: 'connecting', eventLabel: '' };
    this.jobs = { state: { promise: null, queued: false }, history: { promise: null, queued: false } };
    this.stateRevision = 0;
    this.historyRevision = 0;
    this.generation = 0;
    this.lastEventTime = -Infinity;
    this.seen = new Set();
    this.started = false;
    this.stopped = false;
    this.timer = null;
    this.aborts = new Set();
  }

  publish(patch = {}) {
    this.value = { ...this.value, ...patch };
    this.onChange({ ...this.value, records: [...this.value.records] });
  }

  start() {
    if (this.started && !this.stopped) return Promise.resolve();
    this.started = true;
    this.stopped = false;
    return this.refresh();
  }

  enter() { return this.started && !this.stopped ? this.refresh() : this.start(); }

  refresh() {
    if (this.stopped) return Promise.resolve();
    clearTimeout(this.timer);
    this.timer = null;
    return Promise.all([this.request('state'), this.request('history')]);
  }

  request(kind) {
    if (this.stopped) return Promise.resolve();
    const job = this.jobs[kind];
    if (job.promise) { job.queued = true; return job.promise; }
    job.promise = (async () => {
      do {
        job.queued = false;
        await this.read(kind);
      } while (job.queued && !this.stopped);
    })().finally(() => { job.promise = null; });
    return job.promise;
  }

  async read(kind) {
    const generation = this.generation;
    const revision = kind === 'state' ? this.stateRevision : this.historyRevision;
    const abort = new AbortController();
    this.aborts.add(abort);
    this.publish({ [`${kind}Status`]: 'loading', [`${kind}Error`]: '' });
    try {
      const data = await (kind === 'state'
        ? this.api.getState(this.vehicleId, { signal: abort.signal })
        : this.api.getHistory(this.vehicleId, { signal: abort.signal }));
      if (this.stopped || generation !== this.generation) return;
      // Si WSS llegó durante Fetch, esa respuesta pertenece a una lectura anterior.
      if (kind === 'state') {
        if (revision !== this.stateRevision) return;
        const state = normalizeState(data, this.vehicleId);
        this.applyState(state, 'REST');
        this.publish({ stateStatus: 'ready', stateError: '' });
      } else {
        if (revision !== this.historyRevision) { this.jobs.history.queued = true; return; }
        const records = normalizeHistory(data, this.vehicleId);
        this.publish({ records, historyStatus: 'ready', historyError: '' });
      }
    } catch (error) {
      if (this.stopped || generation !== this.generation || error.code === 'ABORTED') return;
      if ((kind === 'state' ? this.stateRevision : this.historyRevision) !== revision) return;
      this.publish({ [`${kind}Status`]: 'error', [`${kind}Error`]: error.message || 'No fue posible consultar los datos.' });
    } finally { this.aborts.delete(abort); }
  }

  applyState(state, source, event = null) {
    const current = this.value.latest;
    if (!state) { if (!current) this.publish({ latest: null }); return; }
    const epoch = state.epoch ?? event?.epoch ?? null;
    if (current?.epoch != null && (epoch === null || epoch < current.epoch)) return;
    if (source === 'REST' && current?.source?.includes('WSS') && epoch === current.epoch) return;
    // estado_inicial es una fotografía, no un movimiento nuevo al conectar.
    if (event?.type === 'estado_inicial' && current && epoch === current.epoch) return;
    this.publish({ latest: { ...state, epoch, source,
      timeKind: state.epoch === null && event ? 'evento' : 'estado',
      demoId: event?.demoId ?? null, eventType: event?.type ?? null } });
  }

  handleEvent(payload) {
    if (this.stopped) return;
    const event = normalizeEvent(payload, this.vehicleId);
    if (!event || event.order < this.lastEventTime || this.seen.has(event.signature)) return;
    this.lastEventTime = event.order;
    this.seen.add(event.signature);
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value);
    if (event.state !== null || event.type === 'estado_inicial') {
      this.stateRevision += 1;
      this.applyState(event.state, event.type.startsWith('demo_') ? 'DEMO · WSS' : 'WSS', event);
      this.publish({ stateStatus: 'ready', stateError: '' });
    }
    const labels = { demo_inicio: `DEMO ${event.demoId} iniciada`, demo_movimiento: `DEMO ${event.demoId} en curso`,
      demo_fin: `DEMO ${event.demoId} finalizada`, demo_cancelada: `DEMO ${event.demoId} cancelada`,
      demo_error: `DEMO ${event.demoId} con error` };
    this.publish({ eventLabel: labels[event.type] ?? '' });
    if (event.type === 'movimiento_individual') {
      this.historyRevision += 1;
      // La API publica después del commit. Agrupar ráfagas evita N GET simultáneos.
      if (!this.timer) this.timer = setTimeout(() => {
        this.timer = null;
        void this.request('history');
      }, this.debounceMs);
    } else if (event.type === 'demo_error') {
      // Ese evento no trae estado; consultar si el servidor logró persistir DETENER.
      void this.request('state');
    }
  }

  socketStatus(status) {
    const previous = this.value.socket;
    this.publish({ socket: status });
    if (status === 'connected' && previous !== 'connected' && this.started && !this.stopped) {
      // Recuperar por REST los mensajes perdidos mientras WSS estuvo desconectado.
      void this.refresh();
    }
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    clearTimeout(this.timer);
    this.timer = null;
    for (const abort of this.aborts) abort.abort();
    for (const job of Object.values(this.jobs)) job.queued = false;
  }
}
