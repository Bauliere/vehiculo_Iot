const THEMES = Object.freeze([
  { id: 'forest', name: 'Bosque', color: '#071b17' },
  { id: 'violet', name: 'Gris violeta', color: '#14131b' },
  { id: 'eva', name: 'EVA-01', color: '#100d19' },
  { id: 'rose', name: 'Rosa claro', color: '#fff6fa' },
]);
const STORAGE_KEY = 'control-iot-theme';

/** Guarda únicamente la paleta elegida; nunca recibe credenciales. */
export class ThemeManager {
  constructor(document) {
    this.document = document;
    this.index = 0;
  }

  start() {
    try {
      const saved = this.document.defaultView.localStorage.getItem(STORAGE_KEY);
      this.index = Math.max(0, THEMES.findIndex(theme => theme.id === saved));
    } catch { /* La página también funciona cuando se bloquea el almacenamiento. */ }
    this.apply();
    this.document.getElementById('theme-button').addEventListener('click', () => {
      this.index = (this.index + 1) % THEMES.length;
      this.apply();
      try { this.document.defaultView.localStorage.setItem(STORAGE_KEY, THEMES[this.index].id); }
      catch { /* La preferencia solo dura esta sesión si no puede guardarse. */ }
    });
  }

  apply() {
    const theme = THEMES[this.index];
    const next = THEMES[(this.index + 1) % THEMES.length];
    this.document.documentElement.dataset.theme = theme.id;
    const button = this.document.getElementById('theme-button');
    button.title = `${theme.name} · Cambiar a ${next.name}`;
    button.setAttribute('aria-label', `Paleta ${theme.name}. Cambiar a ${next.name}`);
    this.document.getElementById('theme-name').textContent = theme.name;
    this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.color);
  }
}
