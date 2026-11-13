import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import HoldButton from './components/HoldButton.jsx';

export function mountDemoHold(host, onConfirm, durationMs) {
  const original = host.querySelector('#demo-start');
  let disabled = original.disabled;
  const root = createRoot(host);

  const render = () => {
    const button = host.querySelector('#demo-start');
    if (button) button.disabled = disabled;
    root.render(<HoldButton
      id="demo-start"
      disabled={disabled}
      size="sm"
      className="rb-demo-hold"
      holdTime={durationMs}
      hint={`Mantén pulsado durante ${durationMs / 1000} segundos para iniciar la DEMO.`}
      doneLabel="Iniciando…"
      backgroundColor="var(--surface-deep)"
      textColor="var(--accent-strong)"
      fillColor="var(--accent)"
      fillTextColor="var(--ink)"
      fillDirection="right"
      waveAmplitude={3}
      glow={false}
      resetAfter={450}
      icon={<svg aria-hidden="true"><use href="#icon-demo" /></svg>}
      onHold={onConfirm}
    >Iniciar DEMO</HoldButton>);
  };

  flushSync(render);
  host.dataset.enhanced = 'true';
  return {
    setDisabled(value) {
      if (disabled === value) return;
      disabled = value;
      render();
    }
  };
}
