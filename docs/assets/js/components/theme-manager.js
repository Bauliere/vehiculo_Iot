const THEMES = Object.freeze([
  { id: 'silver', name: 'Plata sobre negro', color: '#0a0a0c' },
  { id: 'forest', name: 'Bosque', color: '#071b17' },
  { id: 'violet', name: 'Gris violeta', color: '#14131b' },
  { id: 'eva', name: 'EVA-01', color: '#100d19' },
  { id: 'rose', name: 'Rosa claro', color: '#fff6fa' },
  { id: 'red', name: 'Rojo grafito', color: '#17181b' },
  { id: 'black-yellow', name: 'Negro, amarillo y blanco', color: '#090909' },
  { id: 'white-red', name: 'Rojo y blanco', color: '#57091b' },
]);
const STORAGE_KEY = 'control-iot-theme';
const BACKGROUND_KEY = 'control-iot-background';
const BACKGROUNDS = [
  { id: 'crt', name: 'CRT Warp' },
  { id: 'slats', name: 'Rectángulos' },
];

/** Guarda únicamente la paleta elegida; nunca recibe credenciales. */
export class ThemeManager {
  constructor(document) {
    this.document = document;
    this.index = 0;
    this.background = 0;
  }

  start() {
    try {
      const saved = this.document.defaultView.localStorage.getItem(STORAGE_KEY);
      this.index = Math.max(0, THEMES.findIndex(theme => theme.id === saved));
      const background = this.document.defaultView.localStorage.getItem(BACKGROUND_KEY);
      this.background = Math.max(0, BACKGROUNDS.findIndex(item => item.id === background));
    } catch { /* La página también funciona cuando se bloquea el almacenamiento. */ }
    this.apply();
    this.applyBackground();
    this.document.getElementById('theme-button').addEventListener('click', () => {
      this.index = (this.index + 1) % THEMES.length;
      this.apply();
      try { this.document.defaultView.localStorage.setItem(STORAGE_KEY, THEMES[this.index].id); }
      catch { /* La preferencia solo dura esta sesión si no puede guardarse. */ }
    });
    this.document.getElementById('background-button').addEventListener('click', () => {
      this.background = (this.background + 1) % BACKGROUNDS.length;
      this.applyBackground();
      try { this.document.defaultView.localStorage.setItem(BACKGROUND_KEY, BACKGROUNDS[this.background].id); }
      catch { /* La preferencia también funciona sin almacenamiento. */ }
    });
  }

  applyBackground() {
    const current = BACKGROUNDS[this.background];
    const next = BACKGROUNDS[(this.background + 1) % BACKGROUNDS.length];
    this.document.documentElement.dataset.background = current.id;
    const button = this.document.getElementById('background-button');
    const label = `Fondo ${current.name}. Cambiar a ${next.name}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    this.document.getElementById('background-name').textContent = `Fondo ${current.name}`;
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
