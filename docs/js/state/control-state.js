/** Estado observable: las vistas no envían solicitudes ni deciden movimientos. */
export class ControlState {
  constructor() {
    this.value = {
      phase: 'idle', requested: 'Ninguna acción solicitada', http: 'Pendiente',
      event: 'Sin evento de acción', message: 'Conecta tu sesión para comenzar.',
      tone: 'neutral', commandId: null, demoId: null, demoProgress: '', authError: null,
    };
    this.listeners = new Set();
  }
  update(patch) {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener(this.value);
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.value);
    return () => this.listeners.delete(listener);
  }
}
