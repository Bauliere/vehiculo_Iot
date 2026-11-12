import { commandLabel } from '../domain/catalog.js';

/** Coordina órdenes, DEMO y parada. Un resultado antiguo nunca cambia la acción actual. */
export class ControlController {
  constructor(api, vehicleId, catalog, state, { canOperate = () => true, onNeutral = () => {} } = {}) {
    Object.assign(this, { api, vehicleId, catalog, state, canOperate, onNeutral });
    this.revision = 0;
    this.pending = null;
    this.inFlight = null;
    this.stopPromise = null;
    this.keepGestureDuringStop = false;
    this.demoId = null;
    this.selectedDemoId = null;
    this.intent = null;
    this.lastEventTime = -Infinity;
    this.lastEventSignature = '';
    this.timer = null;
  }

  permitted() {
    if (!this.api.hasKey()) throw new Error('La sesión de control todavía no está disponible.');
    if (this.state.value.authError) throw new Error('La sesión fue rechazada. Pulsa Reconectar en Ajustes.');
    if (!this.canOperate()) throw new Error('Espera a que la API y WebSocket estén disponibles.');
  }

  requestDirection(direction) {
    if (direction === 'stop') return this.stop({ keepGesture: true });
    const command = this.catalog.direction(direction);
    if (command) this.requestCommand(command.id_comando);
  }

  requestCommand(id) {
    try {
      this.permitted();
      if ((this.stopPromise && !this.keepGestureDuringStop) || this.demoId !== null || ['uncertain', 'demo'].includes(this.state.value.phase)) return;
      const command = this.catalog.get(id);
      if (!command) throw new Error('El comando no está activo en este vehículo.');
      if (command.nombre === 'DETENER') return this.stop();
      // Solo se conserva la última dirección pendiente: nunca una cola de movimientos viejos.
      this.pending = command;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.drain(), 100);
    } catch (error) { this.error(error); }
  }

  newIntent(command, label) {
    const revision = ++this.revision;
    this.intent = { revision, id: command?.id_comando, code: command?.codigo, name: command?.nombre,
      since: Date.now(), event: null };
    this.state.update({ phase: 'sending', commandId: command?.id_comando ?? null,
      requested: label, http: 'Enviando…', event: 'Esperando evento', message: `${label}: solicitado.`, tone: 'neutral' });
    return revision;
  }

  async drain() {
    if (this.inFlight || this.stopPromise || this.demoId !== null || this.state.value.phase === 'uncertain' || !this.pending) return;
    const command = this.pending;
    this.pending = null;
    try { this.permitted(); } catch (error) { this.error(error); return; }
    const revision = this.newIntent(command, commandLabel(command));
    const operation = this.api.move(this.vehicleId, command.id_comando);
    this.inFlight = operation;
    try {
      const result = await operation;
      this.validateMovement(result, command);
      if (revision === this.revision) this.state.update({ phase: 'idle', authError: null, authValidated: true, http: 'Aceptado por API · HTTP 200',
        message: 'Orden aceptada. Comprueba su evento WSS.', tone: 'success' });
    } catch (error) {
      if (revision === this.revision) {
        this.pending = null;
        this.error(error);
        // Un timeout no demuestra que el servidor haya descartado el POST.
        if (!error.status || error.status >= 500) {
          this.state.update({ phase: 'uncertain' });
          void this.stop();
        }
      }
    } finally {
      if (this.inFlight === operation) this.inFlight = null;
      if (this.pending && !this.stopPromise) void this.drain();
    }
  }

  validateMovement(result, command) {
    if (result?.id_vehiculo !== this.vehicleId || result?.id_comando !== command.id_comando) {
      throw new Error('La respuesta no coincide con la orden. Solicita DETENER y revisa la API.');
    }
  }

  async startDemo(id) {
    try {
      this.permitted();
      if (!Number.isInteger(id) || id <= 0 || this.demoId !== null || this.inFlight || this.stopPromise || this.state.value.phase === 'uncertain') return;
      clearTimeout(this.timer);
      this.pending = null;
      this.onNeutral();
      this.demoId = id;
      this.selectedDemoId = id;
      const revision = this.newIntent(null, `DEMO ${id}`);
      this.state.update({ phase: 'demo', demoId: id, demoProgress: 'Solicitando inicio…' });
      const operation = this.api.startDemo(this.vehicleId, id);
      this.inFlight = operation;
      try {
        const result = await operation;
        if (result?.id_demo !== id || result?.id_vehiculo !== this.vehicleId) throw new Error('Respuesta de DEMO inesperada.');
        if (revision === this.revision) this.state.update({ authError: null, authValidated: true, http: 'Aceptado por API · HTTP 202',
          ...(this.demoId === id ? { message: 'DEMO aceptada; la secuencia la ejecuta el servidor.', tone: 'success' } : {}) });
      } catch (error) {
        if (revision === this.revision) {
          const otherDemo = this.demoId !== null && this.demoId !== id;
          if (!otherDemo && error.status && error.status < 500) this.demoId = null;
          this.error(error);
          this.state.update({ phase: otherDemo ? 'demo' : this.demoId ? 'uncertain' : 'idle', demoId: this.demoId });
        }
      } finally {
        if (this.inFlight === operation) this.inFlight = null;
      }
    } catch (error) { this.error(error); }
  }

  stop({ keepGesture = false } = {}) {
    clearTimeout(this.timer);
    this.pending = null;
    if (!keepGesture) this.onNeutral();
    if (!this.stopPromise) this.keepGestureDuringStop = keepGesture;
    else if (!keepGesture) this.keepGestureDuringStop = false;
    if (this.stopPromise) return this.stopPromise;
    if (!this.api.hasKey()) { this.error(new Error('No hay sesión de control para solicitar DETENER.')); return Promise.resolve(false); }
    const command = this.catalog.direction('stop');
    if (!command) { this.error(new Error('No se encontró DETENER en el catálogo. Vuelve a comprobar la conexión.')); return Promise.resolve(false); }
    const preceding = this.inFlight;
    const demoId = this.demoId;
    const revision = this.newIntent(command, 'DETENER');
    this.state.update({ phase: 'stopping', message: 'Solicitando detención prioritaria…' });
    const cancel = async (id) => {
      if (!id) return;
      try { await this.api.cancelDemo(this.vehicleId, id); }
      catch (error) { if (error.status !== 404 && error.status !== 409) throw error; }
    };
    const sendStop = async () => {
      try { return await this.api.move(this.vehicleId, command.id_comando); }
      catch (error) {
        if (error.status !== 409 || !(this.demoId || demoId || this.selectedDemoId)) throw error;
        await cancel(this.demoId || demoId || this.selectedDemoId);
        return await this.api.move(this.vehicleId, command.id_comando);
      }
    };
    this.stopPromise = (async () => {
      let result;
      let failure;
      try {
        await cancel(this.demoId || demoId);
        result = await sendStop();
      } catch (error) { failure = error; }
      // El POST anterior pudo terminar después del primer STOP: reafirmar la parada.
      // No se abortan escrituras fingiendo que abortar Fetch revierte una transacción.
      if (preceding) {
        await preceding.catch(() => {});
        try { await cancel(this.demoId || demoId); result = await sendStop(); failure = null; }
        catch (error) { failure = error; }
      }
      if (failure) throw failure;
      this.validateMovement(result, command);
      if (revision === this.revision) {
        this.demoId = null;
        this.state.update({ phase: 'idle', authError: null, authValidated: true, commandId: null, demoId: null, demoProgress: demoId ? 'DEMO detenida. Puedes iniciar otro recorrido.' : '', http: 'DETENER aceptado · HTTP 200',
          message: 'DETENER aceptado por la API.', tone: 'success' });
      }
      return true;
    })().catch(error => {
      if (revision === this.revision) {
        this.error(error);
        const reason = error.status === 401
          ? 'La API rechazó la sesión (HTTP 401). Pulsa Reconectar en Ajustes y vuelve a pulsar DETENER.'
          : error.status === 403
            ? 'La sesión no tiene permiso (HTTP 403). Revisa la configuración del servidor y vuelve a pulsar DETENER.'
            : `${error.message || 'No hubo respuesta válida de la API.'} Vuelve a pulsar DETENER.`;
        this.state.update({ phase: 'uncertain', message: `No se pudo confirmar DETENER. ${reason}` });
      }
      return false;
    }).finally(() => {
      this.stopPromise = null;
      this.keepGestureDuringStop = false;
      if (this.pending) void this.drain();
    });
    return this.stopPromise;
  }

  handleEvent(event) {
    if (event?.id_vehiculo !== this.vehicleId || typeof event.tipo !== 'string') return;
    const time = Date.parse(event.timestamp);
    const signature = `${event.tipo}:${event.timestamp}:${event.id_comando ?? ''}:${event.orden ?? ''}`;
    if (!Number.isFinite(time) || time < this.lastEventTime || signature === this.lastEventSignature) return;
    this.lastEventTime = time;
    this.lastEventSignature = signature;
    if (event.tipo === 'estado_inicial') return; // Informativo; nunca repetir el último movimiento.
    const stopping = ['stopping', 'uncertain'].includes(this.state.value.phase);
    if (stopping && ['demo_inicio', 'demo_movimiento'].includes(event.tipo) && Number.isInteger(event.id_demo) && event.id_demo > 0) {
      // Recordar qué cancelar sin permitir que un evento reactive la vista durante STOP.
      this.demoId = event.id_demo;
      return;
    }
    if (event.tipo === 'demo_inicio' && Number.isInteger(event.id_demo) && event.id_demo > 0 && !stopping) {
      this.pending = null;
      this.onNeutral();
      this.demoId = event.id_demo;
      this.state.update({ phase: 'demo', demoId: event.id_demo, demoProgress: `DEMO ${event.id_demo} · ${event.total_movimientos ?? 'N'} pasos`,
        event: `Inicio de DEMO · ${event.timestamp}`, message: 'DEMO en ejecución en el servidor.' });
    } else if (event.tipo === 'demo_movimiento' && Number.isInteger(event.id_demo) && event.id_demo > 0 &&
      Number.isInteger(event.orden) && event.orden > 0 && Number.isInteger(event.duracion_ms) && Number.isInteger(event.pausa_ms) && !stopping) {
      this.pending = null;
      this.onNeutral();
      this.demoId = event.id_demo;
      this.state.update({ phase: 'demo', demoId: event.id_demo, demoProgress: `Paso ${event.orden} · ${commandLabel(event.comando)}`,
        event: `Paso de DEMO · ${event.timestamp}`, message: `Evento recibido: ${commandLabel(event.comando)}.` });
    } else if (['demo_fin', 'demo_cancelada', 'demo_error'].includes(event.tipo) && event.id_demo === this.demoId) {
      this.demoId = null;
      if (!stopping) this.state.update({ phase: event.tipo === 'demo_error' ? 'uncertain' : 'idle', demoId: null, demoProgress: event.tipo === 'demo_error' ? 'Error en DEMO. Solicita DETENER y revisa el servidor.' : 'DEMO terminada',
        event: `${commandLabel(event.tipo)} · ${event.timestamp}`, message: `Evento recibido: ${commandLabel(event.tipo)}.`, tone: event.tipo === 'demo_error' ? 'error' : 'success' });
    } else if (event.tipo === 'movimiento_individual' && this.intent &&
      event.id_comando === this.intent.id && event.codigo === this.intent.code && event.comando === this.intent.name &&
      time >= this.intent.since - 5000) {
      // API sin request_id: correspondencia temporal, no prueba de autoría entre varios clientes.
      this.intent.event = event;
      this.state.update({ event: `${commandLabel(event.comando)} · código ${event.codigo} · ${event.timestamp}` });
    }
  }

  connectionLost() {
    if (this.pending || this.inFlight || this.demoId || this.state.value.commandId) void this.stop();
  }

  error(error) {
    const message = error?.message || 'No se pudo completar la operación.';
    const phase = ['uncertain', 'stopping', 'demo'].includes(this.state.value.phase) ? this.state.value.phase : 'idle';
    this.state.update({ phase, tone: 'error', http: error.status ? `Error HTTP ${error.status}` : 'Sin confirmación HTTP', message,
      ...([401, 403].includes(error.status) ? { authError: error.status, authValidated: false } : {}) });
  }
}
