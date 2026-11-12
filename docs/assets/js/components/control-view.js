import { commandLabel } from '../domain/catalog.js';

/** Solo representación. Los datos remotos se insertan como texto, nunca como HTML. */
export class ControlView {
  constructor(document) { this.document = document; }
  get(id) { return this.document.getElementById(id); }
  text(id, value) { const node = this.get(id); if (node) node.textContent = value; }
  status(id, state, label) {
    const node = this.get(id);
    node.dataset.state = state;
    node.querySelector('[data-status-text]').textContent = label;
  }
  vehicle(vehicle) {
    this.text('vehicle-name', vehicle.nombre);
    this.text('vehicle-id', `VEHÍCULO ${vehicle.id_vehiculo.toString().padStart(2, '0')}`);
  }
  commands(commands, onCommand) {
    const container = this.get('extra-controls');
    container.replaceChildren();
    for (const command of commands.filter(command => !['SUBIR_CAJA', 'BAJAR_CAJA'].includes(command.nombre))) {
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
    if (!commands.length) container.textContent = 'Sin controles adicionales activos.';
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
  availability({ enabled, pending, demo, hasKey, ready, selectedDemo, uncertain }) {
    for (const button of this.get('extra-controls').querySelectorAll('button')) button.disabled = !enabled || button.dataset.placeholder === 'true';
    this.get('demo-start').disabled = !enabled || pending || !selectedDemo;
    this.get('demo-cancel').disabled = !hasKey || (!demo && !uncertain);
    this.get('demo-select').disabled = !ready || demo || pending;
    // DETENER sigue disponible durante solicitudes, DEMO y fallos de conectividad.
    this.get('stop-button').disabled = !hasKey || !ready;
  }
}
