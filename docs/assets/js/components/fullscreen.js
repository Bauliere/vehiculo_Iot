export class PilotFullscreen {
  constructor(document, navigation) {
    this.document = document;
    this.navigation = navigation;
    this.root = document.documentElement;
    this.button = document.getElementById('fullscreen-button');
  }

  start() {
    this.button.addEventListener('click', () => void this.toggle());
    this.document.addEventListener('fullscreenchange', () => this.sync(Boolean(this.document.fullscreenElement)));
    this.document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.root.hasAttribute('data-pilot-fullscreen') &&
          !this.document.fullscreenElement && !this.document.querySelector('dialog[open]')) this.sync(false);
    });
  }

  async toggle() {
    if (this.root.hasAttribute('data-pilot-fullscreen')) {
      if (this.document.fullscreenElement) await this.document.exitFullscreen();
      else this.sync(false);
      return;
    }
    this.navigation.showView('control');
    this.sync(true);
    try { await this.root.requestFullscreen?.(); }
    catch { /* En navegadores sin pantalla completa se oculta la navegación de la app. */ }
  }

  sync(active) {
    const label = active ? 'Salir de pantalla completa' : 'Pantalla completa';
    this.root.toggleAttribute('data-pilot-fullscreen', active);
    this.button.setAttribute('aria-pressed', String(active));
    this.button.setAttribute('aria-label', label);
    this.button.title = label;
    this.button.querySelector('use').setAttribute('href', active ? '#icon-minimize' : '#icon-fullscreen');
  }
}
