/** Errores públicos: no mostramos trazas ni respuestas internas del servidor. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', diagnostic = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export function errorMessage(error) {
  if (error instanceof ApiError) return error.message;
  return 'No fue posible completar la operación. Inténtalo de nuevo.';
}

export function httpError(status, diagnostic = false) {
  const messages = {
    400: 'La solicitud no es compatible con esta operación.',
    401: 'Introduce una clave válida en Acceso de control.',
    403: 'La clave no tiene permiso para controlar este vehículo.',
    404: 'El recurso no existe o ya no está disponible.',
    409: 'Hay un conflicto. Puede existir una DEMO activa o un recurso inactivo.',
    422: 'La API rechazó los datos. Revisa el catálogo y la configuración.',
    429: 'Se enviaron demasiadas solicitudes. Espera unos segundos.',
    500: 'La API encontró un error interno.',
    503: 'El servicio solicitado no está disponible temporalmente.',
  };
  return new ApiError(messages[status] ?? `La API respondió con HTTP ${status}.`, {
    status, code: 'HTTP', diagnostic,
  });
}

export function requireId(value, name = 'identificador') {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
    throw new ApiError(`El ${name} debe ser un entero positivo.`, { code: 'VALIDATION' });
  }
  return value;
}

export function validateServiceUrl(value, websocket = false) {
  let url;
  try { url = new URL(value); } catch {
    throw new ApiError('La dirección del servicio no es válida.', { code: 'CONFIG' });
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const secure = websocket ? 'wss:' : 'https:';
  const insecure = websocket ? 'ws:' : 'http:';
  if ((url.protocol !== secure && !(local && url.protocol === insecure))
      || url.username || url.password || url.search || url.hash) {
    throw new ApiError(`Usa una dirección ${secure}// sin credenciales ni parámetros.`, {
      code: 'CONFIG',
    });
  }
  return url.href.replace(/\/$/, '');
}
