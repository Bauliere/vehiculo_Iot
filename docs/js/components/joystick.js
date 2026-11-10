/** Entrada de dirección: ratón, pantalla táctil y teclado comparten las mismas transiciones. */
export class Joystick {
  constructor(element, { onDirection = () => {}, onRelease = () => {} } = {}) {
    this.element = element;
    this.stick = element.querySelector('.joystick-stick');
    this.label = element.ownerDocument.getElementById('joystick-label');
    this.onDirection = onDirection;
    this.onRelease = onRelease;
    this.enabled = false;
    this.pointer = null;
    this.key = null;
    this.direction = 'stop';
    this.active = false;
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    element.addEventListener('pointerdown', event => this.pointerDown(event), options);
    element.addEventListener('pointermove', event => this.pointerMove(event), options);
    element.addEventListener('pointerup', event => this.pointerEnd(event), options);
    element.addEventListener('pointercancel', event => this.pointerEnd(event), options);
    element.addEventListener('lostpointercapture', event => this.pointerEnd(event), options);
    element.addEventListener('keydown', event => this.keyDown(event), options);
    element.addEventListener('keyup', event => this.keyUp(event), options);
    element.addEventListener('blur', () => this.release(), options);
    const view = element.ownerDocument.defaultView;
    view.addEventListener('blur', () => this.release(), options);
    element.ownerDocument.addEventListener('visibilitychange', () => {
      if (element.ownerDocument.hidden) this.release();
    }, options);
    this.setEnabled(false);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.element.setAttribute('aria-disabled', String(!this.enabled));
    if (!this.enabled) this.release();
  }

  pointerDown(event) {
    if (!this.enabled || event.button !== 0 || this.active) return;
    event.preventDefault();
    this.element.focus({ preventScroll: true });
    this.pointer = event.pointerId;
    this.active = true;
    this.element.dataset.active = 'true';
    this.element.setPointerCapture(event.pointerId);
    this.pointerMove(event);
  }

  pointerMove(event) {
    if (event.pointerId !== this.pointer || !this.active) return;
    event.preventDefault();
    const bounds = this.element.getBoundingClientRect();
    const radius = bounds.width * 0.30;
    let x = event.clientX - bounds.left - bounds.width / 2;
    let y = event.clientY - bounds.top - bounds.height / 2;
    const distance = Math.hypot(x, y);
    if (distance > radius) { x *= radius / distance; y *= radius / distance; }
    this.stick.style.transform = `translate(${x}px, ${y}px)`;
    const direction = distance < bounds.width * 0.13 ? 'stop'
      : Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right')
        : (y < 0 ? 'forward' : 'backward');
    this.changeDirection(direction);
  }

  pointerEnd(event) {
    if (event.pointerId === this.pointer) this.release();
  }

  keyDown(event) {
    const directions = { ArrowUp: 'forward', ArrowDown: 'backward', ArrowLeft: 'left', ArrowRight: 'right' };
    if (!directions[event.key]) return;
    event.preventDefault();
    if (!this.enabled || this.pointer !== null || event.repeat) return;
    this.key = event.key;
    this.active = true;
    this.element.dataset.active = 'true';
    const offset = this.element.getBoundingClientRect().width * 0.25;
    const x = event.key === 'ArrowLeft' ? -offset : event.key === 'ArrowRight' ? offset : 0;
    const y = event.key === 'ArrowUp' ? -offset : event.key === 'ArrowDown' ? offset : 0;
    this.stick.style.transform = `translate(${x}px, ${y}px)`;
    this.changeDirection(directions[event.key]);
  }

  keyUp(event) {
    if (event.key === this.key) { event.preventDefault(); this.release(); }
  }

  changeDirection(direction) {
    if (direction === this.direction) return;
    this.direction = direction;
    const labels = { forward: 'Avanzar', backward: 'Retroceder', left: 'Girar a la izquierda', right: 'Girar a la derecha', stop: 'En posición neutral' };
    if (this.label) this.label.textContent = labels[direction];
    this.element.dataset.direction = direction;
    this.onDirection(direction);
  }

  release() {
    if (!this.active) return;
    this.reset();
    this.onRelease();
  }

  /** El coordinador puede centrar el control sin provocar otra solicitud de detención. */
  reset() {
    const pointer = this.pointer;
    this.pointer = null;
    this.key = null;
    this.active = false;
    this.direction = 'stop';
    this.element.dataset.active = 'false';
    this.element.dataset.direction = 'stop';
    this.stick.style.transform = 'translate(0px, 0px)';
    if (this.label) this.label.textContent = 'En posición neutral';
    if (pointer !== null && this.element.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer);
  }

  destroy() { this.reset(); this.abort.abort(); }
}
