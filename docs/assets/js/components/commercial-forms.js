import { commandLabel } from '../domain/catalog.js';
import { action, field, group, node } from './commercial-ui.js';

export const STATUSES = [
  ['disponible', 'Disponible'], ['vendida', 'Asignada'], ['exhibicion', 'Exhibición'], ['inactiva', 'Inactiva'],
];

function textField(name, label, row, maxLength, required = false, type = 'text') {
  return field(name, label, { value: row[name], maxLength, required, type });
}

function activeField(row) {
  return field('activo', 'Activo', { value: row.activo ?? true, type: 'checkbox' });
}

function namedFields(row, maxLength) {
  return [textField('nombre', 'Nombre', row, maxLength, true), textField('descripcion', 'Descripción (opcional)', row,
    maxLength === 120 ? 500 : 255, false, 'textarea')];
}

function removeRow(button, row, list, afterChange) {
  const focus = row.nextElementSibling ?? row.previousElementSibling;
  row.remove();
  afterChange();
  (focus?.querySelector('select, input') ?? list.nextElementSibling.querySelector('button') ?? button).focus();
}

export function modelForm(row) {
  const legend = node('legend', 'Capacidades del hardware');
  const help = node('p', 'Usa los nombres y códigos del firmware. Incluye DETENER. Marca sólo los movimientos permitidos en exhibición.', 'commercial-muted');
  const list = node('ul', '', 'commercial-steps');
  const add = action('Agregar capacidad', () => append({}).querySelector('input').focus());
  const append = data => {
    const item = node('li');
    const remove = action('Quitar capacidad', () => removeRow(remove, item, list, sync), { glyph: 'close' });
    item.append(field('cap_nombre', 'Comando', { value: data.nombre, required: true, maxLength: 60,
      pattern: '[A-Za-z][A-Za-z0-9_]*', placeholder: 'DETENER', autocapitalize: 'characters' }),
    field('cap_codigo', 'Código', { type: 'number', required: true, value: data.codigo, min: -2147483648, max: 2147483647, step: 1 }),
    field('cap_exhibicion', 'Exhibición', { value: data.exhibicion, type: 'checkbox' }), remove);
    list.append(item);
    sync();
    return item;
  };
  function sync() { add.disabled = list.childElementCount >= 32; }
  for (const item of row.capacidades ?? []) append(item);
  const capabilities = node('fieldset');
  capabilities.append(legend, help, list, group('commercial-actions', add));
  return {
    fields: [...namedFields(row, 120), textField('foto_url', 'URL HTTPS de la foto (opcional)', row, 512, false, 'url'), activeField(row), capabilities],
    payload: data => ({ nombre: data.get('nombre'), descripcion: data.get('descripcion') || null,
      foto_url: data.get('foto_url') || null, activo: data.has('activo'),
      capacidades: [...list.children].map(item => ({ nombre: item.querySelector('[name="cap_nombre"]').value,
        codigo: item.querySelector('[name="cap_codigo"]').valueAsNumber, exhibicion: item.querySelector('[name="cap_exhibicion"]').checked })) }),
  };
}

export function unitForm(row, models) {
  const available = models.filter(model => model.activo || model.id_modelo === row.id_modelo);
  const states = row.id_cliente ? STATUSES.filter(([name]) => name === 'vendida') : STATUSES.filter(([name]) => name !== 'vendida');
  return {
    fields: [
      group('commercial-form-grid', textField('nombre', 'Nombre de la unidad', row, 80, true),
        textField('identificador_fisico', 'Identificador físico o número de serie', row, 80, true)),
      group('commercial-form-grid', field('id_modelo', 'Modelo', { value: row.id_modelo,
        options: [['', 'Selecciona un modelo'], ...available.map(item => [item.id_modelo, item.nombre])], required: true }),
      field('estado_comercial', 'Estado comercial', { value: row.estado_comercial ?? 'disponible', options: states })),
      textField('microcontrolador', 'Microcontrolador (opcional)', row, 50),
      textField('descripcion', 'Descripción (opcional)', row, 255, false, 'textarea'),
    ],
    payload: data => ({ ...Object.fromEntries(data), id_modelo: Number(data.get('id_modelo')) }),
  };
}

export function customerForm(row) {
  return {
    fields: [textField('nombre', 'Nombre completo', row, 120, true),
      textField('correo', 'Correo electrónico', row, 254, true, 'email'),
      field('clave', row.id_cliente ? 'Nueva contraseña (opcional)' : 'Contraseña', { type: 'password', required: !row.id_cliente,
        minLength: 12, maxLength: 128, autocomplete: 'new-password', note: 'Al menos 12 caracteres.' }), activeField(row)],
    payload: data => ({ nombre: data.get('nombre'), correo: data.get('correo'), activo: data.has('activo'), clave: data.get('clave') || null }),
  };
}

export function demoForm(row, commands) {
  const list = node('ol', '', 'commercial-steps');
  const total = node('p', '', 'commercial-muted');
  const add = action('Agregar paso', () => append({}).querySelector('select').focus());
  const options = [['', 'Selecciona un comando'], ...commands.map(command => [command.id_comando, commandLabel(command)])];

  function move(item, next) {
    const sibling = next ? item.nextElementSibling : item.previousElementSibling;
    if (!sibling) return;
    if (next) sibling.after(item);
    else sibling.before(item);
    sync();
    (item.querySelectorAll('button')[Number(next)].disabled ? item.querySelector('select')
      : item.querySelectorAll('button')[Number(next)]).focus();
  }

  function readSteps() {
    return [...list.children].map(item => ({ id_comando: Number(item.querySelector('select').value),
      duracion_ms: item.querySelector('[name="duracion_ms"]').valueAsNumber,
      pausa_ms: item.querySelector('[name="pausa_ms"]').valueAsNumber }));
  }

  function sync() {
    [...list.children].forEach((item, index) => {
      const [up, down, remove] = item.querySelectorAll('button');
      const step = index + 1;
      item.querySelector('label span').textContent = `Paso ${step} · Comando`;
      up.disabled = !index;
      down.disabled = step === list.childElementCount;
      for (const [button, text] of [[up, 'Subir'], [down, 'Bajar'], [remove, 'Quitar']]) {
        button.setAttribute('aria-label', `${text} paso ${step}`);
        button.title = `${text} paso ${step}`;
      }
    });
    const duration = readSteps().reduce((sum, step) => sum + (step.duracion_ms || 0) + (step.pausa_ms || 0), 0);
    total.textContent = `${(duration / 1000).toLocaleString('es-MX')} s de 60 s permitidos`;
    add.disabled = list.childElementCount >= 24 || !commands.length;
  }

  function append(step) {
    const item = node('li');
    const remove = action('Quitar paso', () => removeRow(remove, item, list, sync), { glyph: 'close' });
    item.append(field('id_comando', 'Comando', { options, value: step.id_comando, required: true }),
      field('duracion_ms', 'Duración (ms)', { type: 'number', required: true, min: 1, max: 10000, value: step.duracion_ms ?? 500 }),
      field('pausa_ms', 'Pausa (ms)', { type: 'number', required: true, min: 0, max: 10000, value: step.pausa_ms ?? 0 }),
      group('commercial-actions', action('Subir paso', () => move(item, false), { glyph: 'up' }),
        action('Bajar paso', () => move(item, true), { glyph: 'down' }), remove));
    list.append(item);
    sync();
    return item;
  }
  for (const step of row.pasos ?? []) append(step);
  if (!list.childElementCount && commands.length) append({});
  list.addEventListener('input', sync);
  sync();
  const steps = node('fieldset');
  steps.append(node('legend', 'Secuencia'), list, group('commercial-actions', add, total));
  return {
    fields: [...namedFields(row, 80), activeField(row), steps],
    payload: data => ({ nombre: data.get('nombre'), descripcion: data.get('descripcion') || null,
      activo: data.has('activo'), pasos: readSteps() }),
  };
}
