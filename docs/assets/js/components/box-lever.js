/** Palanca de caja con retorno al centro: no envía peticiones ni repite órdenes. */
export class BoxLever {
  constructor(element, { onDirection = () => {}, onRelease = () => {} } = {}) {
    this.element = element;
    this.stick = element.querySelector('.box-lever-stick');
    this.label = element.ownerDocument.getElementById('box-lever-label');
    this.onDirection = onDirection;
    this.onRelease = onRelease;
    this.enabled = false;
    this.active = false;
    this.pointer = null;
    this.key = null;
    this.direction = 'stop';
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
    element.ownerDocument.defaultView.addEventListener('blur', () => this.release(), options);
    element.ownerDocument.addEventListener('visibilitychange', () => {
      if (element.ownerDocument.hidden) this.release();
    }, options);
    element.setAttribute('role', 'slider');
    element.setAttribute('aria-orientation', 'vertical');
    element.setAttribute('aria-valuemin', '-1');
    element.setAttribute('aria-valuemax', '1');
    this.reset();
    this.setEnabled(false);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.element.setAttribute('aria-disabled', String(!this.enabled));
    if (!this.enabled) this.release();
  }

  pointerDown(event) {
    if (!this.enabled || this.active || event.button !== 0) return;
    event.preventDefault();
    this.element.focus({ preventScroll: true });
    this.pointer = event.pointerId;
    this.active = true;
    this.element.dataset.active = 'true';
    this.element.setPointerCapture(event.pointerId);
    this.pointerMove(event);
  }

  pointerMove(event) {
    if (!this.active || event.pointerId !== this.pointer) return;
    event.preventDefault();
    const bounds = this.element.getBoundingClientRect();
    const distance = event.clientY - bounds.top - bounds.height / 2;
    const travel = bounds.height * 0.28;
    const position = Math.max(-travel, Math.min(travel, distance));
    this.stick.style.transform = `translateY(${position}px)`;
    // La franja central permite detener antes de invertir la dirección de la caja.
    const direction = Math.abs(distance) < bounds.height * 0.14 ? 'stop' : distance < 0 ? 'up' : 'down';
    this.changeDirection(direction);
  }

  pointerEnd(event) {
    if (event.pointerId === this.pointer) this.release();
  }

  keyDown(event) {
    const directions = { ArrowUp: 'up', ArrowDown: 'down' };
    if (!directions[event.key] && event.key !== 'Home' && event.key !== 'Escape') return;
    event.preventDefault();
    if (!this.enabled || this.pointer !== null || event.repeat) return;
    if (event.key === 'Home' || event.key === 'Escape') {
      if (this.active) this.release();
      else this.onRelease();
      return;
    }
    this.key = event.key;
    this.active = true;
    this.element.dataset.active = 'true';
    const travel = this.element.getBoundingClientRect().height * 0.28;
    this.stick.style.transform = `translateY(${event.key === 'ArrowUp' ? -travel : travel}px)`;
    this.changeDirection(directions[event.key]);
  }

  keyUp(event) {
    if (event.key === this.key) { event.preventDefault(); this.release(); }
  }

  changeDirection(direction) {
    if (direction === this.direction) return;
    this.direction = direction;
    this.describePosition();
    this.onDirection(direction);
  }

  describePosition() {
    const labels = { up: 'Subir caja', down: 'Bajar caja', stop: 'Caja en posición neutral' };
    const values = { up: '1', down: '-1', stop: '0' };
    this.element.dataset.direction = this.direction;
    this.element.setAttribute('aria-valuenow', values[this.direction]);
    this.element.setAttribute('aria-valuetext', labels[this.direction]);
    if (this.label) this.label.textContent = labels[this.direction];
  }

  release() {
    if (!this.active) return;
    this.reset();
    this.onRelease();
  }

  /** Centrado visual solicitado por el coordinador; evita una segunda orden DETENER. */
  reset() {
    const pointer = this.pointer;
    this.pointer = null;
    this.key = null;
    this.active = false;
    this.direction = 'stop';
    this.element.dataset.active = 'false';
    this.stick.style.transform = 'translateY(0px)';
    this.describePosition();
    if (pointer !== null && this.element.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer);
  }

  destroy() { this.release(); this.abort.abort(); }
}
