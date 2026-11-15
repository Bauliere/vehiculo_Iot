import { createRoot } from 'react-dom/client';
import ElectricLogo from './components/ElectricLogo.jsx';
import ThoughtLine from './components/ThoughtLine.jsx';

export function mountChatEffects(dialog) {
  const logo = dialog.querySelector('#fausto-electric');
  const image = logo.previousElementSibling;
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
    const palette = getComputedStyle(theme);
    electricRoot.render(<ElectricLogo src={image.src}
      color={palette.getPropertyValue('--accent-strong').trim()}
      glowColor={palette.getPropertyValue('--accent').trim()}
      theme={theme.dataset.theme === 'rose' ? 'light' : 'dark'}
      scale={0.82} intensity={0.48} glow={0.2} thickness={0.45} fill={0.15}
      strands={2} bend={0.31} crackle={0.65} arcs={0.45} speed={1.7}
      flicker={0.18} cursorIntensity={0.55} cursorRadius={40} onRender={logoReady} />);
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
