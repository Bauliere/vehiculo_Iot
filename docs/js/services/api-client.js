import { ApiError, httpError, requireId, validateServiceUrl } from '../utils/errors.js';

/** Único punto de acceso HTTP. La clave vive solamente en la memoria de la pestaña. */
export class ApiClient {
  #key = '';

  constructor(baseUrl, { timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = validateServiceUrl(baseUrl);
    this.timeoutMs = timeoutMs;
    // Fetch nativo debe conservar su contexto Window cuando se llama desde una clase.
    this.fetch = fetchImpl.bind(globalThis);
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

  async request(path, { method = 'GET', body, signal, authorized = false } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')
        || path.includes('\\') || path.includes('..')) {
      throw new ApiError('La ruta del servicio no es válida.', { code: 'CONFIG' });
    }
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
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (authorized) headers['X-API-Key'] = this.#key;
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
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
  health(options) { return this.request('/health', options); }
  rdsHealth(options) { return this.request('/health/rds', options); }
}
