import { CONFIG, socketUrl } from './config.js';
import { ApiClient } from './services/api-client.js';
import { SocketClient } from './services/socket-client.js';
import { HealthService } from './services/health-service.js';
import { Catalog } from './domain/catalog.js';
import { ControlState } from './state/control-state.js';
import { ControlController } from './controllers/control-controller.js';
import { ControlView } from './components/control-view.js';
import { Joystick } from './components/joystick.js';
import { ThemeManager } from './components/theme-manager.js';
import { BoxLever } from './components/box-lever.js';
import { Navigation } from './components/navigation.js';
import { MonitorController } from './controllers/monitor-controller.js';
import { MonitorView } from './components/monitor-view.js';
import { ControlFeedback } from './components/control-feedback.js';

/** Punto de composición: conecta clases de dominio, servicios y componentes. */
class ControlApplication {
  constructor() {
    this.api = new ApiClient(CONFIG.apiBaseUrl, { timeoutMs: CONFIG.requestTimeoutMs, automaticVehicleId: CONFIG.vehicleId });
    this.state = new ControlState();
    this.view = new ControlView(document);
    this.theme = new ThemeManager(document);
    this.feedback = new ControlFeedback(document, CONFIG.vehicleId);
    this.sessionLoading = false;
    this.monitorView = new MonitorView(document);
    this.monitor = new MonitorController(this.api, CONFIG.vehicleId, {
      onChange: value => this.monitorView.render(value),
    });
    this.navigation = new Navigation(document, {
      onView: name => {
        if (this.joystick?.active || this.lever?.active) void this.controller.stop();
        if (name === 'monitor') void this.monitor.enter();
      },
      onPanel: () => {
        if (this.joystick?.active || this.lever?.active) void this.controller.stop();
      },
      onResize: () => this.resizeMonitor(),
    });
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
      onNeutral: () => { this.joystick?.reset(); this.lever?.reset(); },
    });
    this.joystick = new Joystick(this.view.get('joystick'), {
      onDirection: direction => {
        if (direction !== 'stop') this.lever?.reset();
        this.controller.requestDirection(direction);
      },
      onRelease: () => void this.controller.stop(),
    });
    this.joystick.setEnabled(false);
    this.lever = new BoxLever(this.view.get('box-lever'), {
      onDirection: direction => {
        if (direction === 'stop') { void this.controller.stop({ keepGesture: true }); return; }
        this.joystick.reset();
        const name = direction === 'up' ? 'SUBIR_CAJA' : 'BAJAR_CAJA';
        const command = this.catalog.all().find(item => item.nombre === name);
        if (command) {
          this.controller.requestCommand(command.id_comando);
          // La palanca también acepta un toque corto; no espera el debounce del joystick.
          void this.controller.drain();
        }
      },
      onRelease: () => void this.controller.stop(),
    });
    this.state.subscribe(value => { this.view.render(value); this.updateControls(); });
    this.socket = new SocketClient(socketUrl(), {
      onStatus: status => this.socketStatus(status),
      onEvent: event => { this.controller.handleEvent(event); this.monitor.handleEvent(event); this.feedback.handleEvent(event); this.updateControls(); },
      onError: message => { this.state.update({ message, tone: 'error' }); },
    });
    this.health = new HealthService(this.api, {
      intervalMs: CONFIG.healthIntervalMs,
      onChange: status => this.healthStatus(status),
    });
  }

  start() {
    this.theme.start();
    this.navigation.start();
    this.view.get('monitor-refresh').addEventListener('click', () => void this.monitor.refresh());
    this.view.get('session-reconnect').addEventListener('click', () => void this.connectSession(true));
    this.view.get('theme-cycle').addEventListener('click', () => this.view.get('theme-button').click());
    this.view.text('developer-credit', `Desarrollado por ${CONFIG.author} · ${CONFIG.year}`);
    this.view.text('academic-credit', `${CONFIG.subject} · Profesor: ${CONFIG.teacher}`);
    const url = this.view.get('api-url');
    url.textContent = 'Swagger UI ↗';
    url.href = `${CONFIG.apiBaseUrl}/docs`;
    this.view.get('stop-button').addEventListener('click', () => void this.controller.stop());
    this.view.get('demo-cancel').addEventListener('click', () => void this.controller.stop());
    this.view.get('demo-start').addEventListener('click', () => {
      this.navigation.closePanel();
      void this.controller.startDemo(this.demoSelection);
    });
    this.view.get('demo-select').addEventListener('change', () => void this.selectDemo());
    this.view.get('refresh-button').addEventListener('click', () => {
      void this.health.check();
      void this.monitor.refresh();
      void this.connectSession(true);
      if (!this.ready) void this.loadCatalog();
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
      this.monitor.stop();
      this.feedback.stop();
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted) { this.socket.start(); this.health.start(); void this.monitor.start(); }
    });
    this.socket.start();
    this.health.start();
    void this.loadCatalog();
    void this.monitor.start();
    void this.connectSession();
  }

  async connectSession(force = false) {
    if (this.sessionLoading) return;
    this.sessionLoading = true;
    this.sessionNotice = '';
    this.updateControls();
    try {
      await this.api.connectControl({ force });
      this.state.update({ authError: null });
    } catch (error) {
      this.sessionNotice = 'Acceso automático no disponible. Revisa el servidor en Ajustes.';
      this.view.text('session-feedback', error.status === 404 || error.status === 403
        ? 'Activa el control público en la instancia con la guía incluida.' : error.message);
    } finally {
      this.sessionLoading = false;
      this.updateControls();
    }
  }

  resizeMonitor() {
    const mobile = this.navigation.mobile.matches;
    const landscape = window.innerWidth > window.innerHeight;
    this.monitorView.setPageSize(!mobile ? 10 : landscape || window.innerHeight <= 520 ? 2 : window.innerHeight < 670 ? 3 : 5);
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
      this.feedback.renderAux();
      this.view.demos(this.demos);
      this.ready = true;
      if (this.demos.some(demo => demo.id_demo === 1)) {
        this.view.get('demo-select').value = '1';
        void this.selectDemo();
      }
      this.state.update({ message: 'Vehículo listo.', tone: 'neutral' });
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
      this.view.text('demo-description', `${steps.length} pasos · ${seconds.toLocaleString('es-MX')} s`);
    } catch (error) {
      if (generation === this.demoGeneration) this.view.text('demo-description', error.message);
    } finally { this.updateControls(); }
  }

  socketStatus(status) {
    this.monitor.socketStatus(status);
    const wasConnected = this.wsConnected;
    this.wsConnected = status === 'connected';
    const states = { connected: ['online', 'En línea'], connecting: ['connecting', 'Conectando'], reconnecting: ['connecting', 'Reconectando'], disconnected: ['offline', 'Desconectado'] };
    this.view.status('ws-status', ...states[status]);
    if (wasConnected && !this.wsConnected) this.controller.connectionLost();
    if (!this.wsConnected) this.feedback.neutral();
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
    if (this.apiAvailable && !wasAvailable && !this.api.hasKey()) void this.connectSession();
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
    const boxCommands = ['SUBIR_CAJA', 'BAJAR_CAJA'].every(name => this.catalog.all().some(command => command.nombre === name));
    this.lever?.setEnabled((enabled || crossingNeutral) && boxCommands);
    this.view.availability({ enabled, pending: phase === 'sending' || phase === 'stopping', demo,
      hasKey: this.api.hasKey(), ready: this.ready, selectedDemo: this.demoSelection, uncertain });
    const accessState = authError ? 'invalid' : !this.apiAvailable || !this.wsConnected ? 'offline'
      : this.api.hasKey() ? 'valid' : 'pending';
    const labels = { invalid: 'Sin permiso', offline: 'Sin conexión', valid: 'Disponible', pending: 'Conectando' };
    this.view.get('session-indicator').dataset.state = accessState;
    this.view.get('access-dot').dataset.state = accessState;
    this.view.text('session-status', labels[accessState]);
    this.view.get('session-reconnect').disabled = this.sessionLoading;
    if (!this.sessionNotice) this.view.text('session-feedback', this.sessionLoading ? 'Conectando automáticamente…'
      : this.api.hasKey() ? 'Sesión de control lista.' : 'No hay sesión de control disponible.');
    const notice = uncertain ? 'Detención sin confirmar · revisa Monitoreo'
      : this.sessionNotice ? 'Acceso no disponible · abre Ajustes'
        : phase === 'stopping' ? 'Deteniendo…'
          : !this.apiAvailable || !this.wsConnected ? 'Conectando servicios…'
            : !this.api.hasKey() ? 'Preparando acceso…'
              : demo ? 'DEMO en curso' : 'Listo para conducir';
    this.view.text('control-notice', notice);
    this.view.get('control-notice').parentElement.dataset.tone = uncertain || authError ? 'error' : 'neutral';
  }
}

new ControlApplication().start();
