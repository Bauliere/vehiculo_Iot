import { ApiError, httpError, requireId, validateServiceUrl } from '../utils/errors.js';

/** Único punto de acceso HTTP. La clave vive solamente en la memoria de la pestaña. */
export class ApiClient {
  #key = '';

  constructor(baseUrl, { timeoutMs = 8000, fetchImpl = globalThis.fetch, automaticVehicleId = null } = {}) {
    this.baseUrl = validateServiceUrl(baseUrl);
    this.timeoutMs = timeoutMs;
    // Fetch nativo debe conservar su contexto Window cuando se llama desde una clase.
    this.fetch = fetchImpl.bind(globalThis);
    this.automaticVehicleId = automaticVehicleId;
    this.sessionExpiry = 0;
    this.sessionPromise = null;
  }

  setKey(value) {
    if (typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 2048) {
      throw new ApiError('La clave de control tiene un formato inválido.', { code: 'VALIDATION' });
    }
    const key = value.trim();
    if (/^(API_(?:ADMIN|CONTROL)_KEY\s*=|["'`])/.test(key)) {
      throw new ApiError('Pega solo el valor de la clave, sin API_CONTROL_KEY=, API_ADMIN_KEY= ni comillas.', { code: 'VALIDATION' });
    }
    this.#key = key;
  }

  hasKey() { return this.#key.length > 0; }

  /** La clave maestra permanece en AWS. El navegador recibe una sesión limitada. */
  async connectControl({ force = false } = {}) {
    if (!this.automaticVehicleId) return;
    if (!force && this.hasKey() && Date.now() < this.sessionExpiry - 30000) return;
    if (this.sessionPromise) return this.sessionPromise;
    this.sessionPromise = (async () => {
      const session = await this.request('/control/sesion');
      if (session?.id_vehiculo !== this.automaticVehicleId || typeof session.token !== 'string' ||
          session.token.length < 32 || !Number.isInteger(session.expires_in) || session.expires_in < 1) {
        throw new ApiError('El servidor no entregó una sesión de control válida.', { code: 'INVALID_RESPONSE' });
      }
      this.setKey(session.token);
      this.sessionExpiry = Date.now() + session.expires_in * 1000;
    })().finally(() => { this.sessionPromise = null; });
    return this.sessionPromise;
  }

  async request(path, { method = 'GET', body, signal, authorized = false, retried = false,
    timeoutMs = this.timeoutMs, keepalive = false } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')
        || path.includes('\\') || path.includes('..')) {
      throw new ApiError('La ruta del servicio no es válida.', { code: 'CONFIG' });
    }
    if (authorized && this.automaticVehicleId) await this.connectControl();
    if (authorized && !this.hasKey()) {
      throw new ApiError('Introduce la clave de control para enviar órdenes.', {
        status: 401, code: 'AUTH_REQUIRED',
      });
    }
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (authorized) headers['X-API-Key'] = this.#key;
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', keepalive,
      });
      let data = null;
      let validJson = false;
      if (response.status !== 204) {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          try { data = await response.json(); validJson = true; } catch { /* Error controlado abajo. */ }
        }
      }
      if (!response.ok) {
        // Un 401 se rechaza antes de ejecutar la orden. Solo ese caso se reintenta.
        if (response.status === 401 && authorized && this.automaticVehicleId && !retried) {
          await this.connectControl({ force: true });
          return this.request(path, { method, body, signal, authorized, retried: true, timeoutMs, keepalive });
        }
        // Solo un JSON de diagnóstico explícito permite atribuir un fallo a RDS.
        const diagnostic = validJson && data !== null && typeof data === 'object'
          && !Array.isArray(data) && typeof data.detail === 'string';
        throw httpError(response.status, diagnostic);
      }
      if (response.status !== 204 && !validJson) {
        throw new ApiError('La API respondió con un formato inesperado.', { code: 'INVALID_RESPONSE' });
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (timedOut) {
        throw new ApiError('Se agotó el tiempo de espera. No se puede confirmar el resultado.', {
          code: 'TIMEOUT',
        });
      }
      if (controller.signal.aborted) {
        throw new ApiError('Solicitud interrumpida. Esto no cancela una acción ya recibida por la API.', {
          code: 'ABORTED',
        });
      }
      throw new ApiError('No se pudo contactar la API. Revisa la conexión, HTTPS y CORS.', {
        code: 'NETWORK',
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  vehiclePath(id) { return `/vehiculos/${requireId(id, 'ID del vehículo')}`; }
  demoPath(vehicleId, demoId) {
    return `${this.vehiclePath(vehicleId)}/demos/${requireId(demoId, 'ID de la DEMO')}`;
  }
  getVehicle(id, options) { return this.request(this.vehiclePath(id), options); }
  getState(id, options) { return this.request(`${this.vehiclePath(id)}/estado`, options); }
  getHistory(id, options) { return this.request(`${this.vehiclePath(id)}/historial`, options); }
  getCommands(id, options) { return this.request(`${this.vehiclePath(id)}/comandos`, options); }
  getDemos(id, options) { return this.request(`${this.vehiclePath(id)}/demos`, options); }
  getDemoSteps(vehicleId, demoId, options) {
    return this.request(`${this.demoPath(vehicleId, demoId)}/movimientos`, options);
  }
  move(vehicleId, commandId, { signal } = {}) {
    return this.request(`${this.vehiclePath(vehicleId)}/movimientos`, {
      method: 'POST', authorized: true, signal,
      body: { id_comando: requireId(commandId, 'ID del comando'), origen: 'API' },
    });
  }
  startDemo(vehicleId, demoId, { signal } = {}) {
    return this.request(`${this.demoPath(vehicleId, demoId)}/iniciar`, {
      method: 'POST', authorized: true, signal,
    });
  }
  cancelDemo(vehicleId, demoId, { signal } = {}) {
    return this.request(`${this.demoPath(vehicleId, demoId)}/cancelar`, {
      method: 'POST', authorized: true, signal,
    });
  }
  interpretFausto(vehicleId, body, signal) {
    return this.request(`${this.vehiclePath(vehicleId)}/fausto/interpretar`, {
      method: 'POST', authorized: true, body, signal, timeoutMs: 20000,
    });
  }
  faustoPlan(vehicleId, planId, action) {
    if (!/^[A-Za-z0-9_-]{22}$/.test(planId) || !['ejecutar', 'cancelar'].includes(action)) {
      throw new ApiError('Identificador de plan inválido.', { code: 'VALIDATION' });
    }
    return this.request(`${this.vehiclePath(vehicleId)}/fausto/${planId}/${action}`, {
      method: 'POST', authorized: true, keepalive: action === 'cancelar',
    });
  }
  health(options) { return this.request('/health', options); }
  rdsHealth(options) { return this.request('/health/rds', options); }
}
