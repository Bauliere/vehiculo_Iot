import { ApiError, requireId } from '../utils/errors.js';

const DIRECTIONS = Object.freeze({
  forward: 'AVANZAR', backward: 'RETROCEDER', left: 'GIRAR_IZQUIERDA',
  right: 'GIRAR_DERECHA', stop: 'DETENER',
});
const LABELS = Object.freeze({
  AVANZAR: 'Avanzar', RETROCEDER: 'Retroceder', GIRAR_IZQUIERDA: 'Izquierda',
  GIRAR_DERECHA: 'Derecha', SUBIR_CAJA: 'Subir caja', BAJAR_CAJA: 'Bajar caja',
  ALTERNAR_LUCES: 'Luces', ALTERNAR_SONIDO: 'Sonido', DETENER: 'Detener',
});

export function commandLabel(command) {
  const name = typeof command === 'string' ? command : command?.nombre;
  if (typeof name !== 'string') return 'Comando';
  return LABELS[name.trim().toUpperCase()] ?? name.replaceAll('_', ' ');
}

/** Resuelve IDs reales del catálogo; un código no sustituye al id_comando. */
export class Catalog {
  constructor(commands) {
    if (!Array.isArray(commands)) {
      throw new ApiError('El catálogo de comandos no tiene un formato válido.', { code: 'INVALID_RESPONSE' });
    }
    this.commands = [];
    const identifiers = new Set();
    const names = new Set();
    for (const command of commands) {
      if (!command || typeof command !== 'object') this.invalid();
      requireId(command.id_comando, 'ID del comando');
      requireId(command.id_vehiculo, 'ID del vehículo');
      if (typeof command.nombre !== 'string' || !command.nombre.trim()
          || !Number.isInteger(command.codigo) || command.codigo < -2147483648
          || command.codigo > 2147483647 || ![0, 1].includes(command.activo)) this.invalid();
      if (identifiers.has(command.id_comando)) this.invalid();
      identifiers.add(command.id_comando);
      if (command.activo !== 1) continue;
      const name = command.nombre.trim().toUpperCase();
      if (names.has(name)) this.invalid();
      names.add(name);
      this.commands.push(Object.freeze({ ...command, nombre: name }));
    }
    Object.freeze(this.commands);
  }

  invalid() {
    throw new ApiError('El catálogo contiene datos inválidos o repetidos.', { code: 'INVALID_RESPONSE' });
  }
  all() { return [...this.commands]; }
  direction(name) { return this.commands.find(command => command.nombre === DIRECTIONS[name]) ?? null; }
  get(id) { return this.commands.find(command => command.id_comando === id) ?? null; }
  extras() { return this.commands.filter(command => !Object.values(DIRECTIONS).includes(command.nombre)); }
}
