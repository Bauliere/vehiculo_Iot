import { validateServiceUrl } from '../utils/errors.js';

/** Sesión del navegador: no identifica presencia del microcontrolador. */
export class SocketClient {
  constructor(url, { onStatus = () => {}, onEvent = () => {}, onError = () => {},
    WebSocketImpl = globalThis.WebSocket, random = Math.random } = {}) {
    this.url = validateServiceUrl(url, true);
    this.onStatus = onStatus;
    this.onEvent = onEvent;
    this.onError = onError;
    this.WebSocketImpl = WebSocketImpl;
    this.random = random;
    this.socket = null;
    this.running = false;
    this.attempts = 0;
    this.timer = null;
    this.openTimer = null;
    this.stableTimer = null;
    this.onOffline = () => {
      if (!this.running) return;
      clearTimeout(this.timer);
      this.onStatus('disconnected');
      this.socket?.close();
    };
    this.onOnline = () => {
      if (!this.running) return;
      clearTimeout(this.timer);
      if (!this.socket || this.socket.readyState > 1) this.connect();
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    globalThis.addEventListener?.('offline', this.onOffline);
    globalThis.addEventListener?.('online', this.onOnline);
    this.connect();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    clearTimeout(this.openTimer);
    clearTimeout(this.stableTimer);
    globalThis.removeEventListener?.('offline', this.onOffline);
    globalThis.removeEventListener?.('online', this.onOnline);
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'Sesión finalizada');
    this.onStatus('disconnected');
  }

  connect() {
    if (!this.running) return;
    if (globalThis.navigator?.onLine === false) {
      this.onStatus('disconnected');
      return;
    }
    this.onStatus(this.attempts ? 'reconnecting' : 'connecting');
    let socket;
    try { socket = new this.WebSocketImpl(this.url); } catch {
      this.onStatus('disconnected');
      this.onError('No fue posible abrir WebSocket. Revisa la dirección WSS.');
      this.schedule();
      return;
    }
    this.socket = socket;
    this.openTimer = setTimeout(() => {
      if (this.socket !== socket || socket.readyState !== 0) return;
      this.onStatus('disconnected');
      socket.close();
    }, 10000);
    socket.addEventListener('open', () => {
      if (this.socket !== socket || !this.running) return;
      clearTimeout(this.openTimer);
      this.onStatus('connected');
      // Una conexión fugaz no reinicia el backoff de fallos repetidos.
      this.stableTimer = setTimeout(() => { this.attempts = 0; }, 10000);
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket || !this.running) return;
      if (typeof event.data !== 'string' || event.data.length > 65536) {
        this.onError('Se recibió un evento WebSocket no válido.');
        return;
      }
      let data;
      try { data = JSON.parse(event.data); } catch {
        this.onError('Se recibió un evento WebSocket no válido.');
        return;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)
          || typeof data.tipo !== 'string' || !Number.isInteger(data.id_vehiculo)
          || typeof data.timestamp !== 'string' || !Number.isFinite(Date.parse(data.timestamp))) {
        this.onError('El evento WebSocket no coincide con el contrato esperado.');
        return;
      }
      this.onEvent(data);
    });
    socket.addEventListener('error', () => {
      if (this.socket !== socket || !this.running) return;
      this.onStatus('disconnected');
      this.onError('La conexión WSS se interrumpió. Se intentará recuperar.');
      socket.close();
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      clearTimeout(this.openTimer);
      clearTimeout(this.stableTimer);
      this.socket = null;
      if (!this.running) return;
      this.onStatus('disconnected');
      this.schedule();
    });
  }

  schedule() {
    if (!this.running || globalThis.navigator?.onLine === false) return;
    clearTimeout(this.timer);
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5));
    this.onStatus('reconnecting');
    this.timer = setTimeout(() => this.connect(), Math.min(30000, Math.round(delay * (0.8 + this.random() * 0.4))));
  }
}
