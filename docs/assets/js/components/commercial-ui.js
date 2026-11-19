export function node(tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  return svg;
}

export function action(text, run, { primary = false, glyph } = {}) {
  const button = node('button', glyph ? '' : text, glyph ? 'icon-button' : `btn ${primary ? 'btn-mint' : 'btn-outline-soft'}`);
  button.type = 'button';
  if (glyph) {
    button.setAttribute('aria-label', text);
    button.title = text;
    button.append(icon(glyph));
  }
  if (run) button.addEventListener('click', run);
  return button;
}

export function group(className, ...children) {
  const div = node('div', '', className);
  div.append(...children);
  return div;
}

export function field(name, label, { value = '', type = 'text', note, options, ...attributes } = {}) {
  const element = node('label', '', type === 'checkbox' ? 'commercial-check' : '');
  const input = node(options ? 'select' : type === 'textarea' ? 'textarea' : 'input', '',
    options ? 'form-select' : type === 'checkbox' ? '' : 'form-control');
  input.name = name;
  if (input.tagName === 'INPUT') input.type = type;
  if (input.tagName === 'TEXTAREA') input.rows = 2;
  Object.assign(input, attributes);
  if (options) for (const [id, title] of options) {
    const option = node('option', title);
    option.value = id;
    input.append(option);
  }
  if (type === 'checkbox') input.checked = Boolean(value);
  else input.value = value ?? '';
  const title = node('span', label);
  element.append(...(type === 'checkbox' ? [input, title] : [title, input]));
  if (note) element.append(node('small', note, 'commercial-muted'));
  return element;
}

export function table(labels, rows) {
  const element = node('table', '', 'commercial-table');
  const labelsRow = element.createTHead().insertRow();
  for (const label of labels) {
    const cell = node('th', label || 'Acciones', label ? '' : 'text-end');
    cell.scope = 'col';
    labelsRow.append(cell);
  }
  const body = element.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const [column, value] of values.entries()) {
      const cell = row.insertCell();
      if (labels[column]) cell.dataset.label = labels[column];
      cell.append(value ?? '—');
    }
  }
  return group('commercial-table-wrap', element);
}

export function paging(rows, offset, size, onPage) {
  if (!offset && rows.length < size) return '';
  const previous = action('Anterior', () => onPage(Math.max(0, offset - size)));
  previous.disabled = !offset;
  const next = action('Siguiente', () => onPage(offset + size));
  next.disabled = rows.length < size;
  return group('commercial-paging', previous, node('span', `Página ${1 + Math.floor(offset / size)}`), next);
}

export function notice(element, message, error = false) {
  element.hidden = !message;
  element.textContent = message;
  element.dataset.tone = error ? 'error' : 'neutral';
}
