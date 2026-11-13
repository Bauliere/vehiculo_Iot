/** Respaldo para el botón HTML cuando el módulo React aún no se ha cargado. */
export function bindHoldGesture(button, duration, onConfirm) {
  const events = new AbortController();
  const options = { signal: events.signal };
  let timer = 0;
  let pointer = null;
  let key = null;

  function cancel() {
    clearTimeout(timer);
    timer = 0;
    const id = pointer;
    pointer = key = null;
    if (id !== null && button.hasPointerCapture(id)) button.releasePointerCapture(id);
  }

  function hold() {
    timer = setTimeout(() => {
      cancel();
      if (!button.disabled && button.getClientRects().length && document.hasFocus()) onConfirm();
    }, duration);
  }

  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || button.disabled || timer) return;
    pointer = event.pointerId;
    button.setPointerCapture(pointer);
    hold();
  }, options);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, event => { if (event.pointerId === pointer) cancel(); }, options);
  }
  button.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    const box = button.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom) cancel();
  }, options);
  button.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancel();
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.repeat || button.disabled || timer) return;
    key = event.key;
    hold();
  }, options);
  button.addEventListener('keyup', event => { if (event.key === key) cancel(); }, options);
  button.addEventListener('blur', cancel, options);
  window.addEventListener('blur', cancel, options);
  document.addEventListener('visibilitychange', cancel, options);
  document.addEventListener('iot:cancel-hold', cancel, options);
  return () => {
    cancel();
    events.abort();
  };
}
