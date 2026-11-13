const CARDS = '#demo-card, #session-card, .latest-panel, .history-panel';

export function mountCardTilt(document, mouse, motion) {
  const cards = [...document.querySelectorAll(CARDS)];
  let active = null;
  let frame = 0;
  let position;

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!active) return;
    active.removeAttribute('data-tilting');
    for (const name of ['x', 'y', 'light-x', 'light-y', 'foil']) active.style.removeProperty('--tilt-' + name);
    active = null;
  }

  for (const card of cards) {
    card.addEventListener('pointermove', event => {
      if (!mouse.matches || motion.matches || event.pointerType !== 'mouse' || event.buttons) return;
      const bounds = card.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      if (active !== card) reset();
      active = card;
      position = {
        x: Math.max(-1, Math.min(1, 2 * (event.clientX - bounds.left) / bounds.width - 1)),
        y: Math.max(-1, Math.min(1, 2 * (event.clientY - bounds.top) / bounds.height - 1))
      };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (active !== card) return;
        card.setAttribute('data-tilting', '');
        card.style.setProperty('--tilt-x', (-position.y * 3.4).toFixed(2) + 'deg');
        card.style.setProperty('--tilt-y', (position.x * 4.2).toFixed(2) + 'deg');
        card.style.setProperty('--tilt-light-x', (50 + position.x * 50).toFixed(1) + '%');
        card.style.setProperty('--tilt-light-y', (50 + position.y * 50).toFixed(1) + '%');
        card.style.setProperty('--tilt-foil', Math.min(0.43, Math.hypot(position.x, position.y) * 0.47).toFixed(2));
      });
    }, { passive: true });
    card.addEventListener('pointerleave', reset);
    card.addEventListener('pointercancel', reset);
  }
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  document.addEventListener('iot:flip', reset);
  mouse.addEventListener('change', reset);
  motion.addEventListener('change', reset);
}
