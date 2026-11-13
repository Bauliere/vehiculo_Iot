import { Component, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import FlipCard from './components/FlipCard.jsx';
import HalftoneReveal from './components/HalftoneReveal.jsx';
import MicroSlats from './components/MicroSlats.jsx';
import TargetCursor from './components/TargetCursor.jsx';
import WarpText from './components/WarpText.jsx';
import { mountCardTilt } from './card-tilt.js';

// Conserva la separación de la cuadrícula anterior al agrandar las piezas.
const SLAT_GAP_SCALE = 1 / Math.sqrt(1.1);

class VisualBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function useRestoreFallback(host) {
  useLayoutEffect(() => () => host.removeAttribute('data-ready'), [host]);
}

function WarpHeading({ host, source, value, color, typography }) {
  useRestoreFallback(host);
  return <WarpText
    text={value}
    color={color}
    {...typography}
    lens="swirl"
    warpStrength={0.1}
    pointerInfluence={0.78}
    pointerStrength={0.42}
    refraction={0.008}
    chromatic={0.12}
    idleDrift={0}
    intro={false}
    clickRipple={false}
    interactionTarget={source}
    onReady={ready => host.toggleAttribute('data-ready', ready)}
  />;
}

function Fausto({ host, logo, accent, paper }) {
  useRestoreFallback(host);
  return <HalftoneReveal
    src={logo}
    mode="duotone"
    inkColor={accent}
    accentColor={accent}
    paperColor={paper}
    cellSize={2.4}
    angle={35}
    dotScale={1.1}
    revealRadius={35}
    softness={0.65}
    linger={0.52}
    approach={20}
    intro={false}
    onReady={ready => host.toggleAttribute('data-ready', ready)}
  />;
}

function FlipSurface({ turned, compact }) {
  return <FlipCard
    decorative
    flipped={turned}
    axis={compact ? 'x' : 'y'}
    flipOnClick={false}
    draggable={false}
    tilt={false}
    glare={false}
    shadow={false}
    radius={compact ? 11 : 16}
    stiffness={135}
    damping={23}
    background="transparent"
    front={<span className="rb-flip-face rb-flip-front" />}
    back={<span className="rb-flip-face rb-flip-back" />}
  />;
}

function withVisualRoot(host) {
  const root = createRoot(host, {
    onCaughtError: () => host.removeAttribute('data-ready'),
    onUncaughtError: () => host.removeAttribute('data-ready')
  });
  return {
    render: component => root.render(<VisualBoundary>{component}</VisualBoundary>)
  };
}

export function mountVisuals(document) {
  const shell = document.querySelector('.app-shell');
  const html = document.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const mouse = matchMedia('(hover: hover) and (pointer: fine)');
  const small = matchMedia('(max-width: 600px), (max-height: 490px), (pointer: coarse)');
  const paletteKeys = ['bg', 'glow', 'surface-deep', 'text', 'accent', 'accent-strong'];
  const logo = document.querySelector('#theme-button img').src;
  const background = withVisualRoot(document.getElementById('slats-effect'));
  const cursorHost = document.getElementById('cursor-effect');
  const cursorHome = cursorHost.parentNode;
  const cursor = withVisualRoot(cursorHost);
  // El cursor decorativo tiene que entrar en la misma capa superior que el diálogo.
  const cursorLayer = new MutationObserver(() => {
    const host = document.querySelector('dialog[open]') || cursorHome;
    if (cursorHost.parentNode !== host) host.append(cursorHost);
  });
  for (const dialog of document.querySelectorAll('dialog')) {
    cursorLayer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }
  const logoHost = document.getElementById('fausto-effect');
  const fausto = withVisualRoot(logoHost);
  const headings = Array.from(document.querySelectorAll('[data-warp-title]'), source => {
    const host = source.parentElement.querySelector('.rb-warp');
    return { source, host, root: withVisualRoot(host) };
  });
  const surfaces = Array.from(document.querySelectorAll('.rb-flip-surface'), host => ({
    host,
    root: withVisualRoot(host),
    turned: false
  }));
  mountCardTilt(document, mouse, motion);

  let webgl = false;
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    webgl = Boolean(probe);
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* Se conserva la interfaz estática. */ }

  const values = () => {
    const style = getComputedStyle(html);
    return Object.fromEntries(paletteKeys.map(key => [key, style.getPropertyValue(`--${key}`).trim()]));
  };

  const syncHeadings = (palette, active) => {
    for (const { source, host, root } of headings) {
      if (!active || source.getClientRects().length !== 1) {
        root.render(null);
        continue;
      }
      const style = getComputedStyle(source);
      root.render(<WarpHeading host={host} source={source} value={source.textContent.trim()}
        color={source.classList.contains('brand-text') ? palette['accent-strong'] : palette.text}
        typography={{
          fontSize: style.fontSize, fontWeight: style.fontWeight, fontFamily: style.fontFamily,
          letterSpacing: style.letterSpacing, lineHeight: style.lineHeight
        }}
      />);
    }
  };

  let previousView = html.dataset.view;
  const sync = () => {
    const palette = values();
    const active = webgl && !motion.matches;
    const animate = !motion.matches;
    const viewChanged = previousView !== html.dataset.view;
    previousView = html.dataset.view;
    background.render(active && <MicroSlats
      preset="swell"
      color={palette.accent}
      glintColor={palette['accent-strong']}
      backgroundColor={palette.bg}
      slatWidth={small.matches ? 7 : 11.5}
      slatHeight={small.matches ? 18 : 30}
      gap={(small.matches ? 2 : 3) * SLAT_GAP_SCALE}
      interactive={mouse.matches}
      fluidTrail
      pointerLight
      touchPulse
      cursorSize={56}
      pulseSize={small.matches ? 92 : 140}
      intro={false}
    />);
    cursor.render(animate && mouse.matches && <TargetCursor
      container={shell}
      targetSelector="button, [role='button'], [data-cursor-target], a, select"
      cursorColor={palette['accent-strong']}
      cursorColorOnTarget={palette.accent}
      size={23}
      cornerSize={7}
      thickness={1.5}
      padding={3}
      dotSize={2}
      blendMode="normal"
      showLabel={false}
      hideDefaultCursor={false}
    />);
    fausto.render(active && <Fausto host={logoHost} logo={logo}
      accent={palette['accent-strong']} paper={palette['surface-deep']} />);
    syncHeadings(palette, active);

    for (const surface of surfaces) {
      const onView = surface.host.dataset.flipSurface === 'view' && viewChanged;
      if (onView) surface.turned = !surface.turned;
      surface.root.render(animate && <FlipSurface turned={surface.turned}
        compact={surface.host.dataset.flipSurface === 'nav'} />);
    }
  };

  let scheduled = 0;
  const scheduleSync = () => {
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      sync();
    });
  };
  const attributes = new MutationObserver(scheduleSync);
  attributes.observe(html, { attributes: true, attributeFilter: ['data-theme', 'data-view'] });
  const titles = new MutationObserver(scheduleSync);
  for (const { source } of headings) titles.observe(source, { childList: true, characterData: true, subtree: true });
  document.addEventListener('iot:flip', event => {
    const group = event.detail;
    if (motion.matches) return;
    for (const surface of surfaces) {
      if (surface.host.dataset.flipSurface !== group) continue;
      surface.turned = !surface.turned;
      surface.root.render(<FlipSurface turned={surface.turned} compact={group === 'nav'} />);
    }
  });
  for (const query of [motion, mouse, small]) query.addEventListener('change', scheduleSync);
  window.addEventListener('resize', scheduleSync, { passive: true });
  sync();
}

