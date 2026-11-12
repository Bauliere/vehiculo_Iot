import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxLever } from '../assets/js/components/box-lever.js';

function fixture() {
  const element = new EventTarget();
  const document = new EventTarget();
  document.defaultView = new EventTarget();
  const label = { textContent: '' };
  document.getElementById = () => label;
  element.ownerDocument = document;
  element.dataset = {};
  element.attributes = {};
  element.setAttribute = (name, value) => { element.attributes[name] = value; };
  const stick = { style: {} };
  element.querySelector = () => stick;
  element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 80, height: 240 });
  element.focus = () => {};
  element.setPointerCapture = id => { element.capture = id; };
  element.hasPointerCapture = id => element.capture === id;
  element.releasePointerCapture = () => { element.capture = null; };
  const calls = [];
  const lever = new BoxLever(element, {
    onDirection: value => calls.push(value), onRelease: () => calls.push('release'),
  });
  const event = (y, extra = {}) => ({ button: 0, pointerId: 1, clientY: y, preventDefault() {}, ...extra });
  return { lever, element, label, document, stick, calls, event };
}

test('Toque superior activa subir y suelta una sola vez aunque pierda captura', () => {
  const f = fixture();
  f.lever.setEnabled(true);
  f.lever.pointerDown(f.event(20));
  assert.equal(f.element.attributes['aria-valuetext'], 'Subir caja');
  assert.equal(f.element.attributes['aria-valuenow'], '1');
  f.lever.pointerEnd(f.event(20));
  f.lever.pointerEnd(f.event(20));
  assert.deepEqual(f.calls, ['up', 'release']);
  assert.equal(f.element.attributes['aria-valuetext'], 'Caja en posición neutral');
  assert.equal(f.stick.style.transform, 'translateY(0px)');
  f.lever.destroy();
});

test('Arrastrar conserva una orden por posición y pasa por neutral antes de bajar', () => {
  const f = fixture();
  f.lever.setEnabled(true);
  f.lever.pointerDown(f.event(20));
  for (let y = 21; y < 70; y++) f.lever.pointerMove(f.event(y));
  f.lever.pointerMove(f.event(120));
  f.lever.pointerMove(f.event(220));
  assert.deepEqual(f.calls, ['up', 'stop', 'down']);
  assert.equal(f.element.attributes['aria-valuenow'], '-1');
  assert.equal(f.element.attributes['aria-valuetext'], 'Bajar caja');
  f.lever.pointerEnd(f.event(220));
  assert.deepEqual(f.calls, ['up', 'stop', 'down', 'release']);
  f.lever.destroy();
});

test('Un segundo dedo y teclado no sustituyen el arrastre activo', () => {
  const f = fixture();
  f.lever.setEnabled(true);
  f.lever.pointerDown(f.event(20));
  f.lever.pointerDown(f.event(220, { pointerId: 2 }));
  f.lever.pointerMove(f.event(220, { pointerId: 2 }));
  f.lever.pointerEnd(f.event(220, { pointerId: 2 }));
  f.lever.keyDown(f.event(0, { key: 'ArrowDown' }));
  assert.deepEqual(f.calls, ['up']);
  assert.equal(f.lever.pointer, 1);
  f.lever.pointerEnd(f.event(20));
  assert.deepEqual(f.calls, ['up', 'release']);
  f.lever.destroy();
});

test('Teclado no repite órdenes y neutraliza al soltar o pulsar Escape', () => {
  const f = fixture();
  f.lever.setEnabled(true);
  f.lever.keyDown(f.event(0, { key: 'ArrowDown' }));
  f.lever.keyDown(f.event(0, { key: 'ArrowDown', repeat: true }));
  f.lever.keyUp(f.event(0, { key: 'ArrowUp' }));
  assert.deepEqual(f.calls, ['down']);
  f.lever.keyUp(f.event(0, { key: 'ArrowDown' }));
  f.lever.keyDown(f.event(0, { key: 'ArrowUp' }));
  f.lever.keyDown(f.event(0, { key: 'Escape' }));
  f.lever.keyUp(f.event(0, { key: 'ArrowUp' }));
  assert.deepEqual(f.calls, ['down', 'release', 'up', 'release']);
  f.lever.destroy();
});

test('Deshabilitar un gesto detiene; deshabilitada no admite nuevos movimientos', () => {
  const f = fixture();
  f.lever.pointerDown(f.event(20));
  f.lever.keyDown(f.event(0, { key: 'ArrowUp' }));
  assert.deepEqual(f.calls, []);
  f.lever.setEnabled(true);
  f.lever.pointerDown(f.event(220));
  f.lever.setEnabled(false);
  f.lever.setEnabled(false);
  f.lever.pointerMove(f.event(20));
  f.lever.pointerEnd(f.event(20));
  assert.deepEqual(f.calls, ['down', 'release']);
  assert.equal(f.element.attributes['aria-disabled'], 'true');
  f.lever.destroy();
});

test('Al ocultar la página o perder foco retorna al centro sin doble parada', () => {
  const f = fixture();
  f.lever.setEnabled(true);
  f.lever.pointerDown(f.event(20));
  f.document.hidden = true;
  f.document.dispatchEvent(new Event('visibilitychange'));
  f.document.defaultView.dispatchEvent(new Event('blur'));
  assert.deepEqual(f.calls, ['up', 'release']);
  assert.equal(f.element.dataset.active, 'false');
  f.lever.destroy();
});

test('Centrado externo durante DETENER no emite una nueva solicitud', () => {
  const f = fixture();
  f.lever.setEnabled(true);
  f.lever.pointerDown(f.event(20));
  f.lever.reset();
  f.lever.pointerEnd(f.event(20));
  f.lever.setEnabled(false);
  assert.deepEqual(f.calls, ['up']);
  assert.equal(f.lever.direction, 'stop');
  assert.equal(f.element.attributes['aria-valuenow'], '0');
  f.lever.destroy();
});
