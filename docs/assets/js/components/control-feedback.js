import { normalizeEvent } from '../domain/monitor-data.js';

/** Representación de eventos. Nunca convierte una animación en una orden nueva. */
export class ControlFeedback {
  constructor(document, vehicleId) {
    Object.assign(this, { document, vehicleId });
    this.aux = { ALTERNAR_LUCES: false, ALTERNAR_SONIDO: false };
    this.known = new Set();
    this.deviceReportsAux = false;
    this.seen = new Set();
    this.lastTime = -Infinity;
    this.timer = null;
    this.flashes = new Map();
    this.auxTimers = new Map();
  }

  handleEvent(payload) {
    if (payload?.tipo === 'auxiliares') {
      if (payload.id_vehiculo !== this.vehicleId || typeof payload.luces !== 'boolean' || typeof payload.sonido !== 'boolean') return;
      for (const timer of this.auxTimers.values()) clearTimeout(timer);
      this.auxTimers.clear();
      this.deviceReportsAux = true;
      this.aux.ALTERNAR_LUCES = payload.luces;
      this.aux.ALTERNAR_SONIDO = payload.sonido;
      this.known = new Set(Object.keys(this.aux));
      this.renderAux();
      return;
    }
    const event = normalizeEvent(payload, this.vehicleId);
    if (!event || event.order < this.lastTime || this.seen.has(event.signature)) return;
    this.seen.add(event.signature);
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value);
    this.lastTime = event.order;
    if (event.type === 'estado_inicial') return;
    if (['demo_fin', 'demo_cancelada', 'demo_error'].includes(event.type)) this.neutral();
    if (!this.deviceReportsAux && ['demo_cancelada', 'demo_error'].includes(event.type)) this.resetAux();
    if (!['movimiento_individual', 'demo_movimiento'].includes(event.type)) return;
    const command = event.state?.command;
    if (Object.hasOwn(this.aux, command)) {
      const action = event.type === 'movimiento_individual' ? 'alternar' : payload.auxiliar;
      if (!this.deviceReportsAux && ['encender', 'apagar', 'alternar'].includes(action)) {
        this.updateAux(command, action, payload.duracion_auxiliar_ms);
      }
      const button = this.document.querySelector(`[data-aux="${command}"]`);
      if (button) {
        button.dataset.flash = 'true';
        clearTimeout(this.flashes.get(command));
        this.flashes.set(command, setTimeout(() => { button.dataset.flash = 'false'; }, 350));
      }
    }
    if (event.type !== 'demo_movimiento') return;
    this.neutral();
    const joystick = this.document.getElementById('joystick');
    const lever = this.document.getElementById('box-lever');
    const directions = { AVANZAR: [0, -1], RETROCEDER: [0, 1], GIRAR_IZQUIERDA: [-1, 0], GIRAR_DERECHA: [1, 0] };
    if (directions[command]) {
      const [x, y] = directions[command];
      const distance = joystick.getBoundingClientRect().width * .25;
      joystick.style.setProperty('--demo-x', `${x * distance}px`);
      joystick.style.setProperty('--demo-y', `${y * distance}px`);
      joystick.dataset.demoActive = 'true';
    } else if (['SUBIR_CAJA', 'BAJAR_CAJA'].includes(command)) {
      lever.style.setProperty('--demo-y', `${lever.getBoundingClientRect().height * .28 * (command === 'SUBIR_CAJA' ? -1 : 1)}px`);
      lever.dataset.demoActive = 'true';
    }
    const duration = Number.isInteger(payload.duracion_ms) ? Math.max(1, Math.min(payload.duracion_ms, 60000)) : 500;
    this.timer = setTimeout(() => this.neutral(), duration);
  }

  updateAux(command, action, duration) {
    clearTimeout(this.auxTimers.get(command));
    this.auxTimers.delete(command);
    this.aux[command] = action === 'alternar' ? !this.aux[command] : action === 'encender';
    this.known.add(command);
    this.renderAux();
    if (this.aux[command] && Number.isInteger(duration) && duration > 0 && duration <= 10000) {
      this.auxTimers.set(command, setTimeout(() => {
        this.auxTimers.delete(command);
        this.aux[command] = false;
        this.renderAux();
      }, duration));
    }
  }

  renderAux() {
    for (const [name, active] of Object.entries(this.aux)) {
      const button = this.document.querySelector(`[data-aux="${name}"]`);
      if (!button) continue;
      const known = this.known.has(name);
      button.dataset.toggle = known ? active ? 'on' : 'off' : 'unknown';
      button.setAttribute('aria-pressed', String(active));
      const label = button.querySelector('.command-feedback');
      if (label) label.textContent = known ? active ? 'Encendido' : 'Apagado' : 'Sin estado';
      const labelName = name === 'ALTERNAR_LUCES' ? 'Luces' : 'Sonido';
      button.title = known ? `${labelName}: ${active ? 'apagar' : 'encender'}. Estado estimado.` : `${labelName}: esperando estado.`;
    }
  }

  neutral() {
    clearTimeout(this.timer);
    this.timer = null;
    for (const id of ['joystick', 'box-lever']) this.document.getElementById(id).dataset.demoActive = 'false';
  }

  resetAux() {
    for (const timer of this.auxTimers.values()) clearTimeout(timer);
    this.auxTimers.clear();
    for (const name of Object.keys(this.aux)) this.aux[name] = false;
    this.known.clear();
    this.deviceReportsAux = false;
    this.renderAux();
  }

  stop() {
    this.neutral();
    for (const timer of this.flashes.values()) clearTimeout(timer);
    this.flashes.clear();
    this.resetAux();
  }
}
