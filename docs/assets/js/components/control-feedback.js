import { normalizeEvent } from '../domain/monitor-data.js';

/** Representación de eventos. Nunca convierte una animación en una orden nueva. */
export class ControlFeedback {
  constructor(document, vehicleId) {
    Object.assign(this, { document, vehicleId });
    this.aux = { ALTERNAR_LUCES: false, ALTERNAR_SONIDO: false };
    this.known = new Set();
    this.seen = new Set();
    this.lastTime = -Infinity;
    this.timer = null;
    this.flashes = new Map();
  }

  handleEvent(payload) {
    const event = normalizeEvent(payload, this.vehicleId);
    if (!event || event.order < this.lastTime || this.seen.has(event.signature)) return;
    this.seen.add(event.signature);
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value);
    this.lastTime = event.order;
    if (event.type === 'estado_inicial') return;
    if (['demo_fin', 'demo_cancelada', 'demo_error'].includes(event.type)) this.neutral();
    if (!['movimiento_individual', 'demo_movimiento'].includes(event.type)) return;
    const command = event.state?.command;
    if (Object.hasOwn(this.aux, command)) {
      // Indicador solicitado en esta sesión. El protocolo no incluye sensor de encendido.
      this.aux[command] = !this.aux[command];
      this.known.add(command);
      this.renderAux();
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

  renderAux() {
    for (const [name, active] of Object.entries(this.aux)) {
      const button = this.document.querySelector(`[data-aux="${name}"]`);
      if (!button) continue;
      const known = this.known.has(name);
      button.dataset.toggle = known ? active ? 'on' : 'off' : 'unknown';
      button.setAttribute('aria-pressed', String(active));
      const label = button.querySelector('.command-feedback');
      if (label) label.textContent = known ? active ? 'Encendido' : 'Apagado' : 'Sin estado';
      button.title = `${name === 'ALTERNAR_LUCES' ? 'Luces' : 'Sonido'}: ${active ? 'apagar' : 'encender'}. Indicador solicitado en esta sesión, sin sensor físico.`;
    }
  }

  neutral() {
    clearTimeout(this.timer);
    this.timer = null;
    for (const id of ['joystick', 'box-lever']) this.document.getElementById(id).dataset.demoActive = 'false';
  }

  stop() { this.neutral(); for (const timer of this.flashes.values()) clearTimeout(timer); }
}
