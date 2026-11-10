import test from 'node:test';
import assert from 'node:assert/strict';
import { Joystick } from '../js/components/joystick.js';

function fixture() {
  const element = new EventTarget();
  const document = new EventTarget();
  document.defaultView = new EventTarget();
  const label = { textContent: '' };
  document.getElementById = () => label;
  element.ownerDocument = document;
  element.dataset = {};
  element.setAttribute = () => {};
  const stick = { style: {} };
  element.querySelector = () => stick;
  element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 240 });
  element.focus = () => {};
  element.setPointerCapture = id => { element.capture = id; };
  element.hasPointerCapture = id => element.capture === id;
  element.releasePointerCapture = () => { element.capture = null; };
  const directions = [];
  let releases = 0;
  const joystick = new Joystick(element, { onDirection: value => directions.push(value), onRelease: () => { releases++; } });
  const event = (x, y, extra = {}) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {}, ...extra });
  return { joystick, element, directions, event, get releases() { return releases; } };
}

test('El joystick emite cambios de dirección, no un POST por píxel', () => {
  const f = fixture();
  f.joystick.setEnabled(true);
  f.joystick.pointerDown(f.event(120, 20));
  for (let y = 21; y < 60; y++) f.joystick.pointerMove(f.event(120, y));
  f.joystick.pointerMove(f.event(220, 120));
  assert.deepEqual(f.directions, ['forward', 'right']);
  f.joystick.destroy();
});

test('Soltar y perder captura juntos producen una sola detención', () => {
  const f = fixture();
  f.joystick.setEnabled(true);
  f.joystick.pointerDown(f.event(120, 20));
  f.joystick.pointerEnd(f.event(120, 20));
  f.joystick.pointerEnd(f.event(120, 20));
  assert.equal(f.releases, 1);
  assert.equal(f.joystick.active, false);
  assert.equal(f.joystick.direction, 'stop');
  f.joystick.destroy();
});

test('Deshabilitar sin gesto no envía detenciones y reset es silencioso', () => {
  const f = fixture();
  f.joystick.setEnabled(false);
  assert.equal(f.releases, 0);
  f.joystick.setEnabled(true);
  f.joystick.pointerDown(f.event(120, 20));
  f.joystick.reset();
  f.joystick.setEnabled(false);
  assert.equal(f.releases, 0);
  f.joystick.destroy();
});

test('Teclado ignora repetición y detiene al soltar la flecha activa', () => {
  const f = fixture();
  f.joystick.setEnabled(true);
  f.joystick.keyDown(f.event(0, 0, { key: 'ArrowDown' }));
  f.joystick.keyDown(f.event(0, 0, { key: 'ArrowDown', repeat: true }));
  f.joystick.keyUp(f.event(0, 0, { key: 'ArrowLeft' }));
  assert.equal(f.releases, 0);
  f.joystick.keyUp(f.event(0, 0, { key: 'ArrowDown' }));
  assert.deepEqual(f.directions, ['backward']);
  assert.equal(f.releases, 1);
  f.joystick.destroy();
});

test('Un segundo puntero no sustituye al gesto activo y blur detiene', () => {
  const f = fixture();
  f.joystick.setEnabled(true);
  f.joystick.pointerDown(f.event(120, 20));
  f.joystick.pointerDown(f.event(220, 120, { pointerId: 2 }));
  f.joystick.pointerMove(f.event(220, 120, { pointerId: 2 }));
  assert.deepEqual(f.directions, ['forward']);
  f.element.ownerDocument.defaultView.dispatchEvent(new Event('blur'));
  assert.equal(f.releases, 1);
  f.joystick.destroy();
});
