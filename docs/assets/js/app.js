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
import { bindHoldGesture, HOLD_ACTION_MS } from './components/hold-gesture.js';
import { PilotFullscreen } from './components/fullscreen.js';
import { FaustoChat } from './components/fausto-chat.js';
import { CommercialView } from './components/commercial-view.js';
import { Showroom } from './components/showroom.js';
import { notice } from './components/commercial-ui.js';


/** Punto de composición: conecta clases de dominio, servicios y componentes. */
class ControlApplication {
  constructor() {
    this.api = new ApiClient(CONFIG.apiBaseUrl, { timeoutMs: CONFIG.requestTimeoutMs, automaticVehicleId: CONFIG.vehicleId });
    this.vehicleId = null;
    this.mode = 'pending';
    this.account = null;
    this.accountNotice = '';
    this.units = [];
    this.unitsError = '';
    this.view = new ControlView(document);
    this.theme = new ThemeManager(document);
    this.sessionLoading = false;
    this.monitorView = new MonitorView(document);
    this.historyResize = new ResizeObserver(() => this.resizeMonitor());
    this.navigation = new Navigation(document, {
      beforeView: (name, previous) => {
        if (previous !== 'showroom' || !this.showroom.reserving || (name === 'control' && this.showroom.session)) return true;
        notice(this.view.get('showroom-notice'), 'Finaliza la prueba antes de cambiar de vista.');
        return false;
      },
      onView: name => {
        if (this.joystick?.active || this.lever?.active) void this.controller.stop();
        if (name === 'monitor' && this.vehicleId) void this.monitor.enter();
        if (name === 'admin') void this.commercial.open();
        else this.commercial.cancel();
        if (name === 'showroom' && this.mode === 'commercial' && !this.showroom.reserving) void this.showroom.load();
        this.syncUnits();
      },
      onPanel: () => {
        if (this.joystick?.active || this.lever?.active) void this.controller.stop();
      },
      onResize: () => this.resizeMonitor(),
    });
    this.catalog = new Catalog([]);
    this.ready = false;
    this.apiAvailable = false;
    this.wsConnected = false;
    this.demoSelection = 0;
    this.demoGeneration = 0;
    this.sessionNotice = '';
    this.fullscreen = new PilotFullscreen(document, this.navigation);
    this.fausto = new FaustoChat(document, this.api, null, {
      canExecute: () => this.ready && this.canSend() && this.apiAvailable && this.api.hasKey() &&
        !this.state.value.authError && this.state.value.phase === 'idle' &&
        !this.controller.demoId && !this.controller.pending && !this.controller.inFlight,
      onOpen: () => {
        this.navigation.closePanel();
        if (this.joystick.active || this.lever.active) void this.controller.stop();
      },
      onRun: () => this.updateControls(),
      onCatalogChange: () => void this.loadCatalog(),
      stop: () => this.controller.stop(),
    });
    this.joystick = new Joystick(this.view.get('joystick'), {
      onDirection: direction => {
        if (direction !== 'stop') this.lever?.reset();
        this.controller.requestDirection(direction);
      },
      onRelease: () => void this.controller.releaseControl(),
    });
    this.joystick.setEnabled(false);
    this.reclaimButton = this.view.get('reclaim-control');
    bindHoldGesture(this.reclaimButton, HOLD_ACTION_MS, () => void this.reclaimControl());
    this.lever = new BoxLever(this.view.get('box-lever'), {
      onDirection: direction => {
        if (direction === 'stop') { void this.controller.releaseControl({ keepGesture: true }); return; }
        this.joystick.reset();
        const name = direction === 'up' ? 'SUBIR_CAJA' : 'BAJAR_CAJA';
        const command = this.catalog.all().find(item => item.nombre === name);
        if (command) {
          this.controller.requestCommand(command.id_comando);
          // La palanca también acepta un toque corto; no espera el debounce del joystick.
          void this.controller.drain();
        }
      },
      onRelease: () => void this.controller.releaseControl(),
    });
    this.commercial = new CommercialView(document, this.api, {
      onSelect: id => this.chooseUnit(id),
      onUnitChange: () => this.fetchUnits(),
      onDemosChange: id => { if (id === this.vehicleId) void this.loadCatalog(); },
      onExpired: () => this.endAccount('La sesión terminó. Vuelve a iniciar sesión.'),
    });
    this.showroom = new Showroom(document, this.api, {
      onStart: (unit, session) => {
        this.api.setAccount(session.token);
        this.units = [unit];
        this.selectVehicle(unit.id_vehiculo);
        this.navigation.showView('control');
        this.view.get('main-control').focus({ preventScroll: true });
      },
      onEnd: leaving => {
        this.selectVehicle(null);
        this.units = [];
        this.api.setAccount();
        this.syncUnits();
        if (!leaving) this.navigation.showView('showroom');
      },
    });
    bindHoldGesture(this.view.get('end-guest-session'), HOLD_ACTION_MS, () => void this.showroom.finish('Prueba finalizada.'));
    this.health = new HealthService(this.api, {
      intervalMs: CONFIG.healthIntervalMs,
      onChange: status => this.healthStatus(status),
    });
  }

  start() {
    this.theme.start();
    this.navigation.start();
    this.fullscreen.start();
    this.fausto.start();
    this.startEffects();
    this.historyResize.observe(this.view.get('monitor-history-body').closest('.history-table-wrap'));
    this.view.text('developer-credit', `Desarrollado por ${CONFIG.author} · ${CONFIG.year}`);
    this.view.text('academic-credit', `${CONFIG.subject} · Profesor: ${CONFIG.teacher}`);
    const url = this.view.get('api-url');
    url.textContent = 'Swagger UI ↗';
    url.href = `${CONFIG.apiBaseUrl}/docs`;
    const stop = () => void (this.fausto.run ? this.fausto.halt() : this.controller.stop());
    this.view.get('stop-button').addEventListener('click', stop);
    this.view.get('commands-stop').addEventListener('click', stop);
    const commandDialog = this.view.get('commands-dialog');
    this.view.get('commands-open').addEventListener('click', () => {
      if (this.joystick.active || this.lever.active) void this.controller.stop();
      commandDialog.showModal();
    });
    this.view.get('commands-close').addEventListener('click', () => commandDialog.close());
    this.view.get('demo-cancel').addEventListener('click', stop);
    this.view.get('demo-select').addEventListener('change', () => void this.selectDemo());
    this.view.get('refresh-button').addEventListener('click', () => void this.retry());
    this.view.get('controlled-unit').addEventListener('change', event => this.chooseUnit(Number(event.target.value)));
    this.startAccountDialog();
    this.view.get('unit-access-action').addEventListener('click', () => {
      if (this.mode === 'offline' || this.unitsError) void this.retry();
      else if (!this.account) this.view.get('account-button').click();
      else this.navigation.showView('admin');
    });
    this.syncUnits();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.connectionLost();
      else void this.health.check();
    });
    window.addEventListener('blur', () => this.connectionLost());
    window.addEventListener('pagehide', () => {
      this.connectionLost();
      this.socket?.stop();
      void this.showroom.finish('', true);
      this.health.stop();
      this.monitor?.stop();
      this.feedback?.stop();
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted) {
        this.socket?.start();
        this.health.start();
        if (!this.showroom.session) void this.monitor?.start();
      }
    });
    this.health.start();
    void this.detectMode();
  }

  connectionLost() {
    if (this.fausto.run) this.fausto.disconnect();
    else this.controller?.connectionLost();
  }

  async detectMode() {
    if (this.detecting || ['legacy', 'commercial'].includes(this.mode)) return;
    this.detecting = true;
    try {
      const config = await this.api.request('/plataforma/config');
      if (typeof config?.activa !== 'boolean') throw new Error('El servidor no identificó el modo de la plataforma.');
      this.setMode(config.activa ? 'commercial' : 'legacy');
    } catch (error) {
      if (error.status === 404) this.setMode('legacy');
      else {
        this.setMode('offline');
        notice(this.view.get('showroom-notice'), error.message, true);
      }
    } finally {
      this.detecting = false;
      this.connectionActions();
    }
  }

  setMode(mode) {
    const previousView = this.navigation.currentView;
    this.mode = mode;
    document.documentElement.toggleAttribute('data-commercial', mode !== 'legacy');
    this.navButton('showroom').hidden = mode === 'legacy';
    this.view.get('account-button').hidden = mode !== 'commercial';
    if (mode === 'legacy') {
      this.syncUnits();
      this.navigation.showView('control');
      this.selectVehicle(CONFIG.vehicleId);
      void this.connectSession();
    } else {
      if (mode === 'commercial') this.api.setAccount();
      this.syncUnits();
      if (this.mode === 'commercial' && previousView === 'showroom') void this.showroom.load();
    }
  }

  navButton(name) { return document.querySelector(`[data-view-target="${name}"]`); }

  makeSocket(id, token, options) {
    return new SocketClient(socketUrl({ ...CONFIG, vehicleId: id }), {
      protocols: token ? ['iot.v1', `auth.${token}`] : undefined, ...options,
    });
  }

  canSend() { return this.wsConnected && (this.mode === 'legacy' || (this.deviceConnected && this.api.channelId && !this.guestReservation)); }

  async reclaimControl() {
    if (this.reclaimButton.hidden || this.reclaimButton.disabled) return;
    const socket = this.socket;
    const id = this.vehicleId;
    this.reclaiming = true;
    this.reclaimError = '';
    this.updateControls();
    try {
      await this.api.request(`/plataforma/unidades/${id}/recuperar-control`, { method: 'POST' });
      if (socket === this.socket) this.guestReservation = false;
    } catch (error) {
      if (socket === this.socket) this.reclaimError = error.message;
    } finally {
      if (socket === this.socket) {
        this.reclaiming = false;
        this.updateControls();
      }
    }
  }

  selectVehicle(id) {
    if (this.vehicleId === id) return;
    this.connectionLost();
    this.unsubscribe?.();
    this.monitor?.stop();
    this.feedback?.stop();
    const oldSocket = this.socket;
    this.socket = null;
    oldSocket?.stop();
    this.catalogRead?.abort();
    this.demoRead?.abort();
    this.demoGeneration += 1;
    this.api.channelId = '';
    this.ready = false;
    this.catalogFailed = false;
    this.deviceConnected = false;
    this.wsConnected = false;
    this.guestReservation = false;
    this.reclaiming = false;
    this.reclaimError = '';
    this.reclaimButton.hidden = true;
    this.view.get('commands-dialog').close();
    this.demoSelection = 0;
    this.vehicleId = id;
    this.fausto.switchVehicle(id);
    if (!id) {
      this.joystick.setEnabled(false);
      this.lever.setEnabled(false);
      if (document.documentElement.hasAttribute('data-pilot-fullscreen')) {
        void this.fullscreen.toggle().catch(() => this.fullscreen.sync(false));
      }
      this.controller = null;
      this.monitor = null;
      this.feedback = null;
      this.view.clearVehicle();
      this.view.render(new ControlState().value);
      this.monitorView.clear();
      this.syncUnits();
      return;
    }
    this.catalog = new Catalog([]);
    this.state = new ControlState();
    this.view.demos([]);
    this.view.commands([], () => {});
    this.view.vehicle({ nombre: this.units.find(unit => unit.id_vehiculo === id)?.nombre ?? 'Máquina de carga', id_vehiculo: id });
    this.feedback = new ControlFeedback(document, id);
    this.monitor = new MonitorController(this.api, id, {
      onChange: value => {
        this.monitorView.render(value);
        this.connectionActions();
      },
    });
    const control = new ControlController(this.api, id, this.catalog, this.state, {
      canOperate: () => this.controller === control && this.ready && this.apiAvailable && this.canSend() && !this.state.value.authError,
      onNeutral: () => { if (this.controller === control) { this.joystick.reset(); this.lever.reset(); } },
    });
    this.controller = control;
    this.unsubscribe = this.state.subscribe(value => { this.view.render(value); this.updateControls(); });
    const guest = this.showroom.session;
    const socket = this.makeSocket(id, guest?.token ?? this.account?.token, {
      onStatus: status => {
        if (socket !== this.socket) return;
        this.socketStatus(status);
        if (guest && status === 'disconnected' && guest.ready) queueMicrotask(() => {
          if (this.showroom.session === guest) void this.showroom.finish('Se perdió la conexión. La prueba terminó.');
        });
      },
      onEvent: event => {
        if (socket !== this.socket || event.id_vehiculo !== id) return;
        if (event.tipo === 'canal_control') {
          this.api.channelId = typeof event.canal === 'string' ? event.canal : '';
          this.deviceConnected = event.dispositivo === true;
          this.guestReservation = !guest && event.reserva_invitado === true;
          if (guest) guest.ready = true;
        } else if (event.tipo === 'reserva_invitado') {
          this.guestReservation = event.activa === true;
          this.reclaimError = '';
        } else if (event.tipo === 'dispositivo') {
          this.deviceConnected = event.conectado === true;
          if (guest && !this.deviceConnected) void this.showroom.finish('El dispositivo se desconectó. La prueba terminó.');
          if (!this.deviceConnected) this.connectionLost();
        } else {
          control.handleEvent(event);
          if (!guest) this.monitor.handleEvent(event);
          this.feedback.handleEvent(event);
          this.fausto.handleEvent(event);
        }
        this.updateControls();
      },
      onError: message => { if (socket === this.socket) this.state.update({ message, tone: 'error' }); },
      onPolicy: () => {
        if (socket === this.socket && guest) void this.showroom.finish('La reserva de invitado terminó.');
        if (socket === this.socket && this.account) {
          this.ready = false;
          void this.fetchUnits().then(() => this.loadCatalog());
        }
      },
    });
    this.socket = socket;
    this.monitor.publish({ socket: 'connecting' });
    socket.start();
    void this.loadCatalog();
    if (!guest) void this.monitor.start();
    this.syncUnits();
  }

  chooseUnit(id) {
    if (!this.units.some(unit => unit.id_vehiculo === id)) return;
    this.selectVehicle(id);
    this.navigation.showView('control');
  }

  syncUnits() {
    const guest = Boolean(this.showroom.session);
    const pilot = this.mode === 'legacy' || (this.mode === 'commercial' && this.units.length > 0);
    this.navButton('admin').hidden = !this.account;
    this.navButton('monitor').hidden = guest;
    this.navButton('showroom').hidden = this.mode === 'legacy' || guest || this.mode === 'pending';
    this.view.get('account-button').hidden = this.mode !== 'commercial' || guest;
    this.view.get('exhibition-session').hidden = !guest;
    this.view.get('fullscreen-button').hidden = !pilot;
    this.view.text('admin-nav-label', this.account?.cuenta.rol === 'usuario' ? 'Mis vehículos' : 'Administración');
    const switcher = this.view.get('unit-switcher');
    switcher.hidden = this.mode !== 'commercial' || this.units.length < 2 || !['control', 'monitor'].includes(this.navigation.currentView);
    const select = this.view.get('controlled-unit');
    select.replaceChildren(...this.units.map(unit => new Option(unit.nombre, unit.id_vehiculo)));
    select.value = this.vehicleId ?? '';
    this.syncUnitAccess();
    this.connectionActions();
  }

  syncUnitAccess() {
    const locked = this.mode !== 'legacy' && !this.vehicleId;
    document.documentElement.toggleAttribute('data-unit-locked', locked);
    this.view.get('control-view').inert = locked;
    this.view.get('monitor-view').inert = locked;
    const banner = this.view.get('unit-access');
    banner.hidden = !locked || !['control', 'monitor'].includes(this.navigation.currentView);
    if (locked && this.mode !== 'pending' && !this.showroom.session) {
      this.view.status('ws-status', 'unverified', this.mode === 'offline' ? 'Sin verificar' : 'Sin unidad');
    }
    if (banner.hidden) return;

    let message;
    let action = '';
    if (this.mode === 'pending') {
      message = 'Comprobando acceso al vehículo…';
    } else if (this.mode === 'offline') {
      message = 'No se pudo comprobar el acceso al vehículo.';
      action = 'Reintentar';
    } else if (!this.account) {
      message = this.accountNotice || 'Entra con tu cuenta para usar tu vehículo.';
      action = 'Entrar a mi cuenta';
    } else if (this.fetchingUnits) {
      message = 'Consultando tus unidades…';
    } else if (this.unitsError) {
      message = this.unitsError;
      action = 'Reintentar';
    } else if (this.account.cuenta.rol === 'administrador') {
      message = 'Para usar Control o Monitoreo, el comprador debe autorizar soporte a tu cuenta.';
      action = 'Abrir Administración';
    } else {
      message = 'Tu cuenta todavía no tiene vehículos asignados.';
    }
    this.view.text('unit-access-message', message);
    this.view.text('unit-access-action', action);
    this.view.get('unit-access-action').hidden = !action;
  }

  async fetchUnits() {
    const account = this.account;
    if (!account || this.fetchingUnits === account) return;
    this.fetchingUnits = account;
    this.unitsError = '';
    this.syncUnitAccess();
    try {
      const rows = [];
      let page;
      do {
        page = await this.api.request(`/plataforma/mis-unidades?limit=100&offset=${rows.length}`);
        if (this.account !== account) return;
        rows.push(...page);
      } while (page.length === 100);
      this.units = rows;
      if (!rows.some(unit => unit.id_vehiculo === this.vehicleId)) this.selectVehicle(rows[0]?.id_vehiculo ?? null);
      if (this.vehicleId && this.socket && !this.socket.running) this.socket.start();
    } catch (error) {
      if (this.account !== account) return;
      if (error.status === 401) this.endAccount('La sesión terminó. Vuelve a iniciar sesión.');
      else {
        this.unitsError = 'No se pudieron consultar las unidades asignadas.';
        notice(this.view.get('commercial-notice'), error.message, true);
      }
    } finally {
      if (this.fetchingUnits === account) this.fetchingUnits = null;
      if (this.account === account) this.syncUnits();
    }
  }

  startAccountDialog() {
    const dialog = this.view.get('account-dialog');
    const form = this.view.get('account-form');
    const submit = form.querySelector('[type="submit"]');
    const logout = this.view.get('account-logout');
    const message = this.view.get('account-feedback');
    this.view.get('account-button').addEventListener('click', () => {
      if (this.showroom.session || this.showroom.reserving) {
        notice(this.view.get('showroom-notice'), 'Finaliza la prueba antes de iniciar sesión.', true);
        return;
      }
      notice(message, '');
      dialog.showModal();
    });
    dialog.querySelector('[data-close-dialog]').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      notice(message, 'Iniciando sesión…');
      try {
        const body = Object.fromEntries(new FormData(form));
        this.account = await this.api.request('/plataforma/sesion', { method: 'POST', body });
        this.accountNotice = '';
        this.api.setAccount(this.account.token);
        this.commercial.setAccount(this.account.cuenta);
        this.syncAccountDialog();
        this.syncUnits();
        if (this.navigation.currentView === 'showroom') this.navigation.showView('control');
        void this.fetchUnits();
        this.expires = setTimeout(() => this.endAccount('La sesión terminó. Vuelve a iniciar sesión.'),
          Math.max(0, Date.parse(this.account.vence) - Date.now()));
        form.reset();
        dialog.close();
        this.view.get('main-control').focus({ preventScroll: true });
      } catch (error) { notice(message, error.message, true); }
      finally { submit.disabled = false; }
    });
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      try {
        await this.api.request('/plataforma/sesion', { method: 'DELETE' });
        this.endAccount('Sesión cerrada.');
        dialog.close();
      } catch (error) {
        if (error.status === 401) this.endAccount('La sesión terminó.');
        else notice(message, error.message, true);
      } finally { logout.disabled = false; }
    });
  }

  syncAccountDialog() {
    const signedIn = Boolean(this.account);
    const label = signedIn ? 'Cuenta' : 'Iniciar sesión';
    this.view.get('account-button').setAttribute('aria-label', label);
    this.view.get('account-button').title = label;
    this.view.text('account-heading', label);
    this.view.get('account-form').hidden = signedIn;
    this.view.get('account-logout').hidden = !signedIn;
    this.view.get('account-identity').hidden = !signedIn;
    this.view.text('account-identity', this.account?.cuenta.nombre ?? '');
  }

  endAccount(message) {
    clearTimeout(this.expires);
    this.selectVehicle(null);
    this.account = null;
    this.accountNotice = message;
    this.units = [];
    this.unitsError = '';
    this.fetchingUnits = null;
    this.api.setAccount();
    this.commercial.setAccount(null);
    this.syncAccountDialog();
    this.syncUnits();
    this.navigation.showView('control');
  }

  async retry() {
    void this.health.check();
    if (this.mode === 'pending' || this.mode === 'offline') { await this.detectMode(); return; }
    if (this.mode === 'legacy') void this.connectSession(true);
    this.socket?.retry();
    if (this.vehicleId) {
      if (!this.ready || this.catalogFailed) void this.loadCatalog();
      if (this.navigation.currentView === 'monitor') void this.monitor.refresh();
    } else if (this.account) void this.fetchUnits();
    else if (!this.showroom.session) void this.showroom.load();
  }

  connectionActions() {
    const monitorFailure = this.vehicleId && this.navigation.currentView === 'monitor' &&
      [this.monitor?.value.stateStatus, this.monitor?.value.historyStatus].includes('error');
    const failed = this.mode === 'offline' || (this.mode !== 'pending' && !this.apiAvailable) || this.catalogFailed || monitorFailure
      || (this.vehicleId && (!this.wsConnected || Boolean(this.sessionNotice) || Boolean(this.state?.value.authError)));
    this.view.get('connection-actions').hidden = !failed;
  }

  startEffects() {
    // Mantiene el mismo gesto aunque el archivo de efectos no se pueda cargar.
    const confirmDemo = () => {
      if (document.hidden || this.view.get('demo-start').disabled) return;
      this.navigation.closePanel();
      void this.controller.startDemo(this.demoSelection);
    };
    const host = this.view.get('demo-start-effect');
    const removeFallback = bindHoldGesture(host.querySelector('button'), HOLD_ACTION_MS, confirmDemo);
    void import('../vendor/iot-effects.js').then(({ mountDemoHold, mountVisuals, mountChatEffects }) => {
      this.fausto.setEffects(mountChatEffects(this.fausto.dialog));
      removeFallback();
      this.view.demoButton = mountDemoHold(host, confirmDemo, HOLD_ACTION_MS);
      mountVisuals(document);
    }).catch(error => console.warn('No se pudieron cargar los efectos de la interfaz.', error));
  }

  async connectSession(force = false) {
    if (this.mode !== 'legacy' || this.sessionLoading) return;
    this.sessionLoading = true;
    this.sessionNotice = '';
    this.updateControls();
    try {
      await this.api.connectControl({ force });
      this.state.update({ authError: null });
    } catch (error) {
      this.sessionNotice = error.status === 403 || error.status === 404
        ? 'El acceso automático está deshabilitado en la instancia' : 'Acceso automático no disponible';
    } finally {
      this.sessionLoading = false;
      this.updateControls();
    }
  }

  resizeMonitor() {
    const mobile = this.navigation.mobile.matches;
    const landscape = window.innerWidth > window.innerHeight;
    if (mobile) {
      this.monitorView.setPageSize(landscape || window.innerHeight <= 520 ? 2 : window.innerHeight < 670 ? 3 : 5);
      return;
    }
    const table = this.view.get('monitor-history-body').closest('table');
    const available = table.parentElement.clientHeight - table.tHead.offsetHeight;
    if (available > 0) this.monitorView.setPageSize(Math.max(1, Math.min(10, Math.floor(available / 36))));
  }

  async loadCatalog() {
    const id = this.vehicleId;
    if (!id || (this.catalogRead && !this.catalogRead.signal.aborted)) return;
    const job = new AbortController();
    this.catalogRead = job;
    try {
      const detail = await this.api.getVehicle(id, { signal: job.signal });
      if (job.signal.aborted) return;
      if (detail?.vehiculo?.id_vehiculo !== id || ![1, true].includes(detail.vehiculo.activo) ||
        typeof detail.vehiculo.nombre !== 'string' || !Array.isArray(detail.demos) ||
        !Array.isArray(detail.comandos) || detail.comandos.some(c => c.id_vehiculo !== id)) {
        throw new Error('La API no devolvió un vehículo activo con un catálogo válido.');
      }
      const catalog = new Catalog(detail.comandos);
      if (!catalog.direction('stop')) throw new Error('Falta DETENER activo en el catálogo. Revisa Swagger.');
      this.catalog = catalog;
      this.controller.catalog = catalog;
      this.demos = detail.demos.filter(d => [1, true].includes(d.activo) && Number.isInteger(d.id_demo) && d.id_demo > 0 && d.id_vehiculo === id && typeof d.nombre === 'string');
      this.view.vehicle(detail.vehiculo);
      this.view.text('monitor-vehicle', detail.vehiculo.nombre);
      this.view.commands(catalog.extras(), id => this.controller.requestCommand(id));
      this.feedback.renderAux();
      const previousDemo = Number(this.view.get('demo-select').value);
      this.view.demos(this.demos);
      this.ready = true;
      this.catalogFailed = false;
      const nextDemo = this.demos.some(demo => demo.id_demo === previousDemo) ? previousDemo
        : this.demos.some(demo => demo.id_demo === 1) ? 1 : this.demos[0]?.id_demo;
      this.view.get('demo-select').value = nextDemo ? String(nextDemo) : '';
      void this.selectDemo();
      this.state.update({ message: 'Vehículo listo.', tone: 'neutral', authError: null });
    } catch (error) {
      if (!job.signal.aborted) {
        this.catalogFailed = true;
        this.state.update({ message: error.message, tone: 'error' });
      }
    } finally {
      if (this.catalogRead === job) {
        this.catalogRead = null;
        this.updateControls();
      }
    }
  }

  async selectDemo() {
    if (!this.vehicleId) return;
    document.dispatchEvent(new Event('iot:cancel-hold'));
    this.demoRead?.abort();
    const generation = ++this.demoGeneration;
    const id = Number(this.view.get('demo-select').value);
    this.demoSelection = 0;
    this.controller.selectedDemoId = id || null;
    this.updateControls();
    if (!id) { this.view.text('demo-description', 'Elige una DEMO del catálogo para ver sus pasos.'); return; }
    const job = new AbortController();
    this.demoRead = job;
    this.view.text('demo-description', 'Consultando secuencia…');
    try {
      const steps = await this.api.getDemoSteps(this.vehicleId, id, { signal: job.signal });
      if (generation !== this.demoGeneration) return;
      if (!Array.isArray(steps) || steps.some(step => !Number.isInteger(step.orden) || !Number.isInteger(step.duracion_ms) || !Number.isInteger(step.pausa_ms))) throw new Error('La secuencia recibida no es válida.');
      if (!steps.length) { this.view.text('demo-description', 'Esta DEMO no tiene pasos. Complétala desde administración.'); return; }
      const seconds = steps.reduce((sum, step) => sum + step.duracion_ms + step.pausa_ms, 0) / 1000;
      this.demoSelection = id;
      this.view.text('demo-description', `${steps.length} pasos · ${seconds.toLocaleString('es-MX')} s`);
    } catch (error) {
      if (generation === this.demoGeneration) this.view.text('demo-description', error.message);
    } finally {
      if (this.demoRead === job) this.demoRead = null;
      this.updateControls();
    }
  }

  showSocketStatus(status) {
    const states = { connected: ['online', 'En línea'], connecting: ['connecting', 'Conectando'], reconnecting: ['connecting', 'Reconectando'], disconnected: ['offline', 'Desconectado'] };
    this.view.status('ws-status', ...states[status]);
  }

  socketStatus(status) {
    this.monitor.socketStatus(status);
    const wasConnected = this.wsConnected;
    this.wsConnected = status === 'connected';
    this.showSocketStatus(status);
    if (wasConnected && !this.wsConnected) {
      this.feedback.resetAux();
      this.connectionLost();
    }
    if (!this.wsConnected) {
      this.api.channelId = '';
      this.deviceConnected = false;
      this.feedback.neutral();
    }
    this.updateControls();
  }

  healthStatus(status) {
    const wasAvailable = this.apiAvailable;
    if (status.api !== 'checking') this.apiAvailable = status.api === 'available';
    const apiLabels = { available: 'Disponible', checking: 'Comprobando', unavailable: 'No disponible' };
    const rdsLabels = { available: 'Disponible', unavailable: 'No disponible', unverified: 'Sin verificar' };
    this.view.status('api-status', status.api, apiLabels[status.api]);
    this.view.status('rds-status', status.rds, rdsLabels[status.rds]);
    if (wasAvailable && !this.apiAvailable) this.connectionLost();
    if (this.apiAvailable && this.vehicleId && (!this.ready || this.catalogFailed)) void this.loadCatalog();
    if (this.apiAvailable && !wasAvailable) {
      if (this.mode === 'legacy' && !this.api.hasKey()) void this.connectSession();
      else if (this.mode === 'offline') void this.detectMode();
    }
    this.updateControls();
  }

  updateControls() {
    this.connectionActions();
    if (!this.vehicleId || this.controller?.vehicleId !== this.vehicleId) return;
    const phase = this.state.value.phase;
    const demo = this.controller.demoId !== null;
    const uncertain = phase === 'uncertain';
    const authError = this.state.value.authError;
    this.reclaimButton.hidden = !this.guestReservation || this.account?.cuenta.rol !== 'usuario';
    this.reclaimButton.disabled = this.reclaiming || !this.wsConnected || !this.deviceConnected || !this.api.channelId || !this.apiAvailable;
    const enabled = this.ready && this.api.hasKey() && !authError && this.apiAvailable && this.canSend() &&
      !demo && !this.fausto.run && !uncertain && phase !== 'stopping';
    const hasDirection = ['forward', 'backward', 'left', 'right'].some(name => this.catalog.direction(name));
    const crossingNeutral = this.controller.keepGestureDuringStop && phase === 'stopping' &&
      this.ready && this.api.hasKey() && !authError && this.apiAvailable && this.canSend() && !demo;
    this.joystick.setEnabled((enabled || crossingNeutral) && hasDirection);
    const boxCommands = ['SUBIR_CAJA', 'BAJAR_CAJA'].every(name => this.catalog.all().some(command => command.nombre === name));
    this.lever?.setEnabled((enabled || crossingNeutral) && boxCommands);
    this.view.availability({ enabled, pending: phase === 'sending' || phase === 'stopping', demo,
      hasKey: this.api.hasKey(), ready: this.ready, selectedDemo: this.demoSelection, uncertain });
    const notice = uncertain ? (authError ? 'Detención sin confirmar · acceso rechazado' : 'Detención sin confirmar · revisa Monitoreo')
      : authError ? 'Sin permiso para operar' : this.sessionNotice ? this.sessionNotice
        : phase === 'stopping' ? 'Deteniendo…'
          : !this.apiAvailable || !this.wsConnected ? 'Conectando servicios…'
            : !this.api.hasKey() ? 'Preparando acceso…'
              : this.mode === 'commercial' && !this.deviceConnected ? 'Dispositivo desconectado'
                : this.reclaiming ? 'Recuperando el mando…'
                : this.reclaimError ? this.reclaimError
                : this.guestReservation ? 'En uso por un invitado'
                : !this.ready ? 'Mandos no disponibles'
                : this.fausto.run ? 'Fausto.IA en curso'
                  : demo ? 'DEMO en curso' : 'Listo para conducir';
    this.view.text('control-notice', notice);
    this.view.get('control-notice').parentElement.dataset.tone = uncertain || authError || this.reclaimError ? 'error' : 'neutral';
  }
}

new ControlApplication().start();
