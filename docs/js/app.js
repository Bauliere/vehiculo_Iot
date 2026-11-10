import { CONFIG, socketUrl } from './config.js';
import { ApiClient } from './services/api-client.js';
import { SocketClient } from './services/socket-client.js';
import { HealthService } from './services/health-service.js';
import { Catalog } from './domain/catalog.js';
import { ControlState } from './state/control-state.js';
import { ControlController } from './controllers/control-controller.js';
import { ControlView } from './components/control-view.js';
import { Joystick } from './components/joystick.js';

/** Punto de composición: conecta clases de dominio, servicios y componentes. */
class ControlApplication {
  constructor() {
    this.api = new ApiClient(CONFIG.apiBaseUrl, { timeoutMs: CONFIG.requestTimeoutMs });
    this.state = new ControlState();
    this.view = new ControlView(document);
    this.catalog = new Catalog([]);
    this.ready = false;
    this.loading = false;
    this.apiAvailable = false;
    this.wsConnected = false;
    this.demoSelection = 0;
    this.demoGeneration = 0;
    this.sessionNotice = '';
    this.controller = new ControlController(this.api, CONFIG.vehicleId, this.catalog, this.state, {
      canOperate: () => this.ready && this.apiAvailable && this.wsConnected && !this.state.value.authError,
      onNeutral: () => this.joystick?.reset(),
    });
    this.joystick = new Joystick(this.view.get('joystick'), {
      onDirection: direction => this.controller.requestDirection(direction),
      onRelease: () => void this.controller.stop(),
    });
    this.joystick.setEnabled(false);
    this.state.subscribe(value => { this.view.render(value); this.updateControls(); });
    this.socket = new SocketClient(socketUrl(), {
      onStatus: status => this.socketStatus(status),
      onEvent: event => { this.controller.handleEvent(event); this.updateControls(); },
      onError: message => { this.state.update({ message, tone: 'error' }); },
    });
    this.health = new HealthService(this.api, {
      intervalMs: CONFIG.healthIntervalMs,
      onChange: status => this.healthStatus(status),
    });
  }

  start() {
    for (const id of ['api-key', 'session-save', 'session-clear']) this.view.get(id).disabled = false;
    this.view.text('developer-credit', `Desarrollado por ${CONFIG.author} · ${CONFIG.year}`);
    this.view.text('academic-credit', `${CONFIG.subject} · Profesor: ${CONFIG.teacher}`);
    const url = this.view.get('api-url');
    url.textContent = new URL(CONFIG.apiBaseUrl).hostname;
    url.href = `${CONFIG.apiBaseUrl}/docs`;
    this.view.get('stop-button').addEventListener('click', () => void this.controller.stop());
    this.view.get('demo-cancel').addEventListener('click', () => void this.controller.stop());
    this.view.get('demo-start').addEventListener('click', () => void this.controller.startDemo(this.demoSelection));
    this.view.get('demo-select').addEventListener('change', () => void this.selectDemo());
    this.view.get('refresh-button').addEventListener('click', () => {
      void this.health.check();
      if (!this.ready) void this.loadCatalog();
    });
    this.view.get('session-form').addEventListener('submit', event => {
      event.preventDefault();
      if (this.controller.inFlight || this.controller.stopPromise || (this.controller.demoId && !this.state.value.authError)) {
        this.sessionNotice = 'Primero detén la operación para cambiar de clave.';
        this.state.update({ message: 'Primero detén la operación para cambiar de clave.', tone: 'error' });
        return;
      }
      try {
        this.api.setKey(this.view.get('api-key').value);
        this.view.get('api-key').value = '';
        this.sessionNotice = '';
        this.view.text('session-status', this.api.hasKey() ? 'Clave cargada · Pendiente de validar' : 'Sin clave de control.');
        const needsStop = this.state.value.phase === 'uncertain' || this.controller.demoId !== null;
        this.state.update({ authError: null, message: this.api.hasKey()
          ? needsStop ? 'Clave actualizada. Pulsa DETENER para confirmar la parada antes de continuar.' : 'Sesión preparada. Elige un control cuando la conexión esté disponible.'
          : 'Introduce una clave para controlar.', tone: 'neutral' });
      } catch (error) { this.sessionNotice = error.message; this.controller.error(error); }
      this.updateControls();
    });
    this.view.get('session-clear').addEventListener('click', async () => {
      if (this.api.hasKey() && (this.controller.inFlight || this.controller.demoId || this.state.value.commandId)) {
        if (!(await this.controller.stop())) return;
      }
      this.api.setKey('');
      this.sessionNotice = '';
      this.state.update({ authError: null });
      this.view.get('api-key').value = '';
      this.view.text('session-status', 'Clave eliminada de esta pestaña.');
      this.updateControls();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.controller.connectionLost();
      else void this.health.check();
    });
    window.addEventListener('blur', () => this.controller.connectionLost());
    window.addEventListener('pagehide', () => {
      this.controller.connectionLost();
      this.socket.stop();
      this.health.stop();
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted) { this.socket.start(); this.health.start(); }
    });
    this.socket.start();
    this.health.start();
    void this.loadCatalog();
  }

  async loadCatalog() {
    if (this.loading) return;
    this.loading = true;
    try {
      const detail = await this.api.getVehicle(CONFIG.vehicleId);
      if (detail?.vehiculo?.id_vehiculo !== CONFIG.vehicleId || detail.vehiculo.activo !== 1 ||
        typeof detail.vehiculo.nombre !== 'string' || !Array.isArray(detail.demos) ||
        !Array.isArray(detail.comandos) || detail.comandos.some(c => c.id_vehiculo !== CONFIG.vehicleId)) {
        throw new Error('La API no devolvió un vehículo activo con un catálogo válido.');
      }
      const catalog = new Catalog(detail.comandos);
      if (!catalog.direction('stop')) throw new Error('Falta DETENER activo en el catálogo. Revisa Swagger.');
      this.catalog = catalog;
      this.controller.catalog = catalog;
      this.demos = detail.demos.filter(d => d.activo === 1 && Number.isInteger(d.id_demo) && d.id_demo > 0 && d.id_vehiculo === CONFIG.vehicleId && typeof d.nombre === 'string');
      this.view.vehicle(detail.vehiculo);
      this.view.commands(catalog.extras(), id => this.controller.requestCommand(id));
      this.view.demos(this.demos);
      this.ready = true;
      this.state.update({ message: 'Catálogo cargado desde la API. Introduce tu clave de control para operar.', tone: 'neutral' });
    } catch (error) {
      this.state.update({ message: error.message, tone: 'error' });
    } finally {
      this.loading = false;
      this.updateControls();
    }
  }

  async selectDemo() {
    const generation = ++this.demoGeneration;
    const id = Number(this.view.get('demo-select').value);
    this.demoSelection = 0;
    this.controller.selectedDemoId = id || null;
    this.updateControls();
    if (!id) { this.view.text('demo-description', 'Elige una DEMO del catálogo para ver sus pasos.'); return; }
    this.view.text('demo-description', 'Consultando secuencia…');
    try {
      const steps = await this.api.getDemoSteps(CONFIG.vehicleId, id);
      if (generation !== this.demoGeneration) return;
      if (!Array.isArray(steps) || steps.some(step => !Number.isInteger(step.orden) || !Number.isInteger(step.duracion_ms) || !Number.isInteger(step.pausa_ms))) throw new Error('La secuencia recibida no es válida.');
      if (!steps.length) { this.view.text('demo-description', 'Esta DEMO no tiene pasos. Complétala desde administración.'); return; }
      const seconds = steps.reduce((sum, step) => sum + step.duracion_ms + step.pausa_ms, 0) / 1000;
      this.demoSelection = id;
      this.view.text('demo-description', `${steps.length} pasos · ${seconds.toLocaleString('es-MX')} s · Secuencia ejecutada por AWS`);
    } catch (error) {
      if (generation === this.demoGeneration) this.view.text('demo-description', error.message);
    } finally { this.updateControls(); }
  }

  socketStatus(status) {
    const wasConnected = this.wsConnected;
    this.wsConnected = status === 'connected';
    const states = { connected: ['online', 'En línea'], connecting: ['connecting', 'Conectando'], reconnecting: ['connecting', 'Reconectando'], disconnected: ['offline', 'Desconectado'] };
    this.view.status('ws-status', ...states[status]);
    if (wasConnected && !this.wsConnected) this.controller.connectionLost();
    this.updateControls();
  }

  healthStatus(status) {
    const wasAvailable = this.apiAvailable;
    if (status.api !== 'checking') this.apiAvailable = status.api === 'available';
    const apiLabels = { available: 'Disponible', checking: 'Comprobando', unavailable: 'No disponible' };
    const rdsLabels = { available: 'Disponible', unavailable: 'No disponible', unverified: 'Sin verificar' };
    this.view.status('api-status', status.api, apiLabels[status.api]);
    this.view.status('rds-status', status.rds, rdsLabels[status.rds]);
    if (wasAvailable && !this.apiAvailable) this.controller.connectionLost();
    if (this.apiAvailable && !this.ready) void this.loadCatalog();
    this.updateControls();
  }

  updateControls() {
    const phase = this.state.value.phase;
    const demo = this.controller.demoId !== null;
    const uncertain = phase === 'uncertain';
    const authError = this.state.value.authError;
    const enabled = this.ready && this.api.hasKey() && !authError && this.apiAvailable && this.wsConnected && !demo && !uncertain && phase !== 'stopping';
    const allDirections = ['forward', 'backward', 'left', 'right'].every(name => this.catalog.direction(name));
    const crossingNeutral = this.controller.keepGestureDuringStop && phase === 'stopping' &&
      this.ready && this.api.hasKey() && !authError && this.apiAvailable && this.wsConnected && !demo;
    this.joystick.setEnabled((enabled || crossingNeutral) && allDirections);
    this.view.availability({ enabled, pending: phase === 'sending' || phase === 'stopping', demo,
      hasKey: this.api.hasKey(), ready: this.ready, selectedDemo: this.demoSelection, uncertain });
    const blocked = [];
    if (!this.apiAvailable) blocked.push('la API aún no responde desde esta página; comprueba conexión, HTTPS y CORS');
    if (!this.ready) blocked.push('falta cargar el catálogo del vehículo');
    if (!this.wsConnected) blocked.push('WebSocket aún no está conectado');
    if (demo) blocked.push('hay una DEMO en ejecución');
    if (uncertain) blocked.push('falta confirmar la parada; pulsa DETENER');
    if (phase === 'stopping') blocked.push('se está confirmando DETENER');
    let access = 'Introduce tu clave y pulsa Activar control.';
    if (this.api.hasKey()) {
      access = 'Clave cargada en esta pestaña. El campo se vació para ocultarla. La API comprobará sus permisos al enviar una orden.';
    }
    if (authError) {
      this.view.text('session-status', `Clave rechazada · HTTP ${authError}`);
      this.view.get('session-panel').open = true;
      access = `La API rechazó la clave de esta pestaña (HTTP ${authError}). Pega el valor vigente de API_CONTROL_KEY del servidor, pulsa Activar control y después DETENER. Local y Pages usan sesiones independientes.`;
    }
    this.view.text('session-feedback', this.sessionNotice || `${access}${blocked.length ? ` Controles bloqueados: ${blocked.join('; ')}.` : this.api.hasKey() ? ' Controles disponibles.' : ''}`);
  }
}

new ControlApplication().start();
