/** Comparte el DOM de las vistas y mueve los paneles al diálogo móvil. */
export class Navigation {
  constructor(document, { onView = () => {}, onPanel = () => {}, onResize = () => {} } = {}) {
    Object.assign(this, { document, onView, onPanel, onResize });
    this.window = document.defaultView;
    this.mobile = this.window.matchMedia('(max-width: 900px), (max-height: 500px) and (max-width: 1200px), (max-height: 500px) and (pointer: coarse)');
    this.shortDesktop = this.window.matchMedia('(max-height: 650px)');
    this.dialog = document.getElementById('control-sheet');
    this.currentView = 'control';
    this.currentCard = null;
    this.placeholder = null;
    this.trigger = null;
  }

  start() {
    for (const button of this.document.querySelectorAll('[data-view-target]')) {
      button.addEventListener('click', () => this.showView(button.dataset.viewTarget));
    }
    for (const button of this.document.querySelectorAll('[data-open-panel]')) {
      button.addEventListener('click', () => this.openPanel(button.dataset.openPanel, button));
    }
    this.document.getElementById('sheet-close').addEventListener('click', () => this.closePanel());
    this.dialog.addEventListener('close', () => this.restorePanel());
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog) return;
      const box = this.dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) this.closePanel();
    });
    this.mobile.addEventListener('change', () => { this.closePanel(); this.onResize(); });
    this.window.addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  showView(name) {
    const target = this.document.querySelector(`[data-view-target="${name}"]`);
    if (!target || target.hidden || name === this.currentView) return;
    this.closePanel();
    this.currentView = name;
    this.document.dispatchEvent(new CustomEvent('iot:flip', { detail: 'nav' }));
    this.document.documentElement.dataset.view = name;
    for (const button of this.document.querySelectorAll('[data-view-target]')) {
      this.document.getElementById(`${button.dataset.viewTarget}-view`).hidden = button.dataset.viewTarget !== name;
      if (button.dataset.viewTarget === name) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    this.window.scrollTo(0, 0);
    this.onView(name);
    this.onResize();
  }

  openPanel(name, trigger = null) {
    const card = this.document.getElementById(`${name}-card`);
    if (!card || this.currentCard === card) return;
    this.onPanel(name);
    const details = card.querySelector('details');
    if (details) details.open = true;
    if (!this.mobile.matches && !this.shortDesktop.matches && name !== 'activity' && !card.closest('[hidden]')) {
      this.document.dispatchEvent(new CustomEvent('iot:flip', { detail: name }));
      (card.querySelector('input, select, button') ?? card).focus({ preventScroll: true });
      return;
    }
    this.closePanel();
    this.trigger = trigger;
    this.placeholder = this.document.createComment('panel en ventana móvil');
    card.before(this.placeholder);
    this.currentCard = card;
    this.document.getElementById('sheet-content').append(card);
    this.document.getElementById('sheet-title').textContent = { demo: 'Recorridos guiados', activity: 'Confirmaciones de la última orden' }[name];
    trigger?.setAttribute('aria-expanded', 'true');
    this.dialog.showModal();
    this.document.dispatchEvent(new CustomEvent('iot:flip', { detail: name }));
    // Evita abrir el teclado del teléfono antes de que el usuario toque el campo.
    this.document.getElementById('sheet-close').focus({ preventScroll: true });
  }

  closePanel() {
    if (this.currentCard) this.document.dispatchEvent(new Event('iot:cancel-hold'));
    if (this.dialog.open) this.dialog.close();
    this.restorePanel();
  }

  restorePanel() {
    if (!this.currentCard) return;
    this.placeholder.replaceWith(this.currentCard);
    this.currentCard = null;
    this.placeholder = null;
    this.trigger?.setAttribute('aria-expanded', 'false');
    this.trigger?.focus({ preventScroll: true });
    this.trigger = null;
  }
}
