import { commandLabel } from '../domain/catalog.js';
import { action } from './commercial-ui.js';

/** Solo representación. Los datos remotos se insertan como texto, nunca como HTML. */
export class ControlView {
  constructor(document) {
    this.document = document;
    this.initialExtras = [...this.get('extra-controls').children];
  }
  get(id) { return this.document.getElementById(id); }
  text(id, value) {
    const node = this.get(id);
    if (node && node.textContent !== value) node.textContent = value;
  }
  status(id, state, label) {
    const node = this.get(id);
    node.dataset.state = state;
    const text = node.querySelector('[data-status-text]');
    if (text.textContent !== label) text.textContent = label;
  }
  vehicle(vehicle) {
    this.text('vehicle-name', vehicle.nombre);
    this.text('vehicle-id', `Vehículo ${vehicle.id_vehiculo.toString().padStart(2, '0')}`);
  }
  clearVehicle() {
    this.text('vehicle-name', 'Control del vehículo');
    this.text('vehicle-id', 'Sin unidad seleccionada');
    this.commands([], () => {});
    this.get('extra-controls').replaceChildren(...this.initialExtras);
    this.demos([]);
    this.get('demo-select').options[0].textContent = 'Sin unidad seleccionada';
    this.text('demo-description', 'Los recorridos se cargan al seleccionar una unidad.');
    this.availability({ enabled: false, ready: false, hasKey: false });
  }
  commands(commands, onCommand) {
    const container = this.get('extra-controls');
    const additional = this.get('additional-controls');
    const auxiliaries = ['ALTERNAR_LUCES', 'ALTERNAR_SONIDO'];
    const box = ['SUBIR_CAJA', 'BAJAR_CAJA'];
    const leverAvailable = box.every(name => commands.some(command => command.nombre === name));
    container.replaceChildren();
    additional.replaceChildren();
    for (const command of commands.filter(command => auxiliaries.includes(command.nombre))) {
      const button = this.document.createElement('button');
      button.type = 'button';
      button.className = 'extra-control';
      button.dataset.commandId = command.id_comando;
      button.dataset.aux = command.nombre;
      button.disabled = true;
      const symbol = this.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      symbol.setAttribute('aria-hidden', 'true');
      const icon = this.document.createElementNS('http://www.w3.org/2000/svg', 'use');
      icon.setAttribute('href', command.nombre === 'ALTERNAR_SONIDO' ? '#icon-sound' : '#icon-light');
      symbol.append(icon);
      const label = this.document.createElement('span');
      label.textContent = commandLabel(command);
      const description = this.document.createElement('small');
      description.textContent = 'Apagado';
      description.className = 'command-feedback';
      button.setAttribute('aria-label', commandLabel(command));
      const led = this.document.createElement('i');
      led.className = 'aux-led status-dot';
      led.setAttribute('aria-hidden', 'true');
      button.append(symbol, label, description, led);
      button.addEventListener('click', () => onCommand(command.id_comando));
      container.append(button);
    }
    if (!container.childElementCount) container.textContent = 'Sin luces ni sonido activos.';
    for (const command of commands.filter(command => !auxiliaries.includes(command.nombre) &&
      !(leverAvailable && box.includes(command.nombre)))) {
      const button = action(commandLabel(command), () => onCommand(command.id_comando));
      button.dataset.commandId = command.id_comando;
      button.disabled = true;
      additional.append(button);
    }
    this.get('commands-open').hidden = !additional.childElementCount;
  }
  demos(demos) {
    const select = this.get('demo-select');
    select.replaceChildren();
    const first = this.document.createElement('option');
    first.value = '';
    first.textContent = demos.length ? 'Elige un recorrido' : 'No hay DEMO disponibles';
    select.append(first);
    for (const demo of demos) {
      const option = this.document.createElement('option');
      option.value = demo.id_demo;
      option.textContent = demo.nombre;
      select.append(option);
    }
  }
  render(state) {
    this.text('action-request', state.requested);
    this.text('action-http', state.http);
    this.text('action-event', state.event);
    this.text('action-message', state.message);
    this.get('action-message').dataset.tone = state.tone;
    if (state.demoProgress) this.text('demo-description', state.demoProgress);
    this.get('stop-button').dataset.busy = String(state.phase === 'stopping');
    for (const button of this.get('extra-controls').querySelectorAll('button')) {
      const active = Number(button.dataset.commandId) === state.commandId;
      button.dataset.active = String(active);
      button.dataset.phase = active ? state.phase : 'idle';
      button.setAttribute('aria-busy', String(active && state.phase === 'sending'));
    }
  }
  availability({ enabled, pending, demo, hasKey, ready, selectedDemo, uncertain, canStop = true }) {
    for (const button of this.get('extra-controls').querySelectorAll('button')) button.disabled = !enabled || button.dataset.placeholder === 'true';
    for (const button of this.get('additional-controls').children) button.disabled = !enabled;
    const demoDisabled = !enabled || pending || !selectedDemo;
    if (this.demoButton) this.demoButton.setDisabled(demoDisabled);
    else this.get('demo-start').disabled = demoDisabled;
    this.get('demo-cancel').disabled = !hasKey || !canStop || (!demo && !uncertain);
    this.get('demo-select').disabled = !ready || demo || pending;
    // DETENER conserva prioridad mientras el canal admite órdenes.
    this.get('stop-button').disabled = !hasKey || !ready || !canStop;
    this.get('commands-stop').disabled = !hasKey || !ready || !canStop;
  }
}
