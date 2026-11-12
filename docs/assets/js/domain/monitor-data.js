import { commandLabel } from './catalog.js';

export const MONITOR_TIME_ZONE = 'America/Mexico_City';
export const MONITOR_ZONE_LABEL = 'Hora de Ciudad de México · UTC−6';
const TYPES = new Set(['estado_inicial', 'movimiento_individual', 'demo_inicio',
  'demo_movimiento', 'demo_fin', 'demo_cancelada', 'demo_error']);
const integer = value => Number.isSafeInteger(value) && value > 0;
const optionalInteger = value => value === null || value === undefined || Number.isSafeInteger(value);

/** La conexión MySQL fija time_zone='+00:00'. Sus fechas sin sufijo son UTC,
 * no la hora local del teléfono. WSS ya incluye +00:00. */
export function parseServerTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const probe = new Date(Date.UTC(+year, +month - 1, +day));
  if (+year < 1000 || probe.getUTCMonth() !== +month - 1 || probe.getUTCDate() !== +day ||
      +hour > 23 || +minute > 59 || +second > 59) return null;
  const result = Date.parse(value.replace(' ', 'T') + (match[8] ? '' : 'Z'));
  return Number.isFinite(result) ? result : null;
}

/** Mantiene el orden de los microsegundos del emisor aunque Date use milisegundos. */
export function serverTimeOrder(value) {
  const epoch = parseServerTime(value);
  if (epoch === null) return null;
  const fraction = /\.(\d{1,6})/.exec(value)?.[1] ?? '';
  return epoch * 1000 + Number(fraction.padEnd(6, '0').slice(3));
}

const dateFormat = new Intl.DateTimeFormat('es-MX', {
  timeZone: MONITOR_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('es-MX', {
  timeZone: MONITOR_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
export function formatServerTime(value) {
  const epoch = typeof value === 'number' ? value : parseServerTime(value);
  if (epoch === null || !Number.isFinite(epoch)) return { date: 'Sin fecha', time: 'Sin hora', iso: '' };
  return { date: dateFormat.format(epoch), time: timeFormat.format(epoch), iso: new Date(epoch).toISOString() };
}

function invalid(message) { throw new Error(message); }

export function normalizeState(value, vehicleId) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.id_vehiculo !== vehicleId ||
      typeof value.vehiculo !== 'string' || !optionalInteger(value.id_comando) ||
      !optionalInteger(value.codigo) || (value.comando !== null && typeof value.comando !== 'string') ||
      ![0, 1].includes(value.conectado)) invalid('El estado recibido no corresponde al vehículo o tiene un formato inválido.');
  const epoch = parseServerTime(value.fecha_actualizacion);
  if (value.fecha_actualizacion != null && epoch === null) invalid('El estado contiene una fecha inválida.');
  return Object.freeze({
    vehicleId, vehicle: value.vehiculo, commandId: value.id_comando ?? null,
    command: value.comando, label: value.comando ? commandLabel(value.comando) : 'Sin movimientos',
    code: value.codigo ?? null, rawTime: value.fecha_actualizacion ?? null, epoch, order: serverTimeOrder(value.fecha_actualizacion),
  });
}

/** La tabla se construye exclusivamente con GET /historial, nunca con eventos. */
export function normalizeHistory(value, vehicleId) {
  if (!Array.isArray(value)) invalid('La API no devolvió una lista de historial válida.');
  const records = new Map();
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) invalid('El historial contiene un registro inválido.');
    if (row.id_vehiculo !== vehicleId) continue;
    if (typeof row.origen !== 'string') invalid('El historial contiene un origen inválido.');
    if (row.origen.trim().toUpperCase() === 'DEMO') continue;
    if (!integer(row.id_historial) || !optionalInteger(row.codigo) ||
        (row.comando !== null && typeof row.comando !== 'string')) invalid('El historial contiene un registro inválido.');
    const epoch = parseServerTime(row.fecha_hora);
    if (row.fecha_hora != null && epoch === null) invalid('El historial contiene una fecha inválida.');
    const item = Object.freeze({ id: row.id_historial, vehicleId, command: row.comando,
      label: row.comando ? commandLabel(row.comando) : 'Comando no disponible', code: row.codigo ?? null,
      rawTime: row.fecha_hora ?? null, epoch, order: serverTimeOrder(row.fecha_hora), origin: row.origen });
    const previous = records.get(item.id);
    if (!previous || (item.epoch ?? -Infinity) > (previous.epoch ?? -Infinity)) records.set(item.id, item);
  }
  return [...records.values()].sort((a, b) =>
    ((b.order ?? -Infinity) - (a.order ?? -Infinity)) || b.id - a.id).slice(0, 10);
}

export function normalizeEvent(value, vehicleId) {
  if (!value || value.id_vehiculo !== vehicleId || !TYPES.has(value.tipo)) return null;
  const epoch = parseServerTime(value.timestamp);
  if (epoch === null) return null;
  if (value.tipo.startsWith('demo_') && !integer(value.id_demo)) return null;
  let state = null;
  try {
    if (value.estado !== undefined) state = normalizeState(value.estado, vehicleId);
    else if (['estado_inicial', 'movimiento_individual', 'demo_movimiento', 'demo_fin', 'demo_cancelada'].includes(value.tipo)) return null;
  } catch { return null; }
  if (['movimiento_individual', 'demo_movimiento'].includes(value.tipo) &&
      (!state || !integer(value.id_comando) || value.id_comando !== state.commandId ||
        value.comando !== state.command || value.codigo !== state.code)) return null;
  return { type: value.tipo, epoch, order: serverTimeOrder(value.timestamp), state, demoId: value.id_demo ?? null,
    signature: JSON.stringify([value.tipo, value.timestamp, value.id_comando,
      value.id_demo, value.orden, state?.rawTime, state?.commandId]) };
}
