import { createRoot } from 'react-dom/client';
import ElectricLogo from './components/ElectricLogo.jsx';
import ThoughtLine from './components/ThoughtLine.jsx';

export function mountChatEffects(dialog) {
  const logo = dialog.querySelector('#fausto-electric');
  const source = new URL(logo.dataset.source, dialog.ownerDocument.baseURI).href;
  const theme = dialog.ownerDocument.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const showFallback = () => logo.removeAttribute('data-ready');
  const electricRoot = createRoot(logo, { onUncaughtError: showFallback });
  const thought = dialog.querySelector('#fausto-thought-effect');
  const thoughtRoot = createRoot(thought, {
    onUncaughtError: () => thought.removeAttribute('data-ready'),
  });
  const logoReady = () => {
    if (!logo.hasAttribute('data-ready')) logo.setAttribute('data-ready', '');
  };

  const syncLogo = () => {
    if (!dialog.open || motion.matches) {
      showFallback();
      electricRoot.render(null);
      return;
    }
    const palette = getComputedStyle(logo);
    // ElectricLogo separa el trazo blanco del fondo oscuro usando su contraste.
    electricRoot.render(<ElectricLogo src={source}
      color={palette.getPropertyValue('--fausto-core').trim()}
      glowColor={palette.getPropertyValue('--fausto-neon').trim()}
      scale={0.74} intensity={0.83} glow={0.78} thickness={0.59} fill={0}
      strands={3} bend={0.35} crackle={0.8} arcs={0.65} speed={1.7}
      flicker={0.2} cursorIntensity={0.5} cursorRadius={45} onRender={logoReady} />);
  };
  const changes = new MutationObserver(syncLogo);
  changes.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  changes.observe(theme, { attributes: true, attributeFilter: ['data-theme'] });
  motion.addEventListener('change', syncLogo);
  syncLogo();

  return {
    thinking(state, elapsed) {
      if (state === null) {
        thoughtRoot.render(null);
        thought.removeAttribute('data-ready');
        return;
      }
      thought.setAttribute('data-ready', '');
      thoughtRoot.render(<ThoughtLine label="Interpretando la orden…"
        doneLabel={state === 'error' ? 'Interpretación interrumpida' : 'Interpretación lista'}
        working={state === 'working'} elapsed={elapsed} collapsible={false}
        fontSize={13} color="var(--muted)" glyphColor="var(--accent-strong)" />);
    },
  };
}
