import { commandLabel } from '../domain/catalog.js';
import { VoiceRecorder } from './voice-recorder.js';

const TERMINAL = new Set(['demo_fin', 'demo_cancelada', 'demo_error']);
const HOLD_TO_TALK_MS = 260;
const CHANGES = Object.freeze({
  crear_comando: 'Crear comando', eliminar_comando: 'Eliminar comando',
  crear_demo: 'Crear DEMO', eliminar_demo: 'Eliminar DEMO',
});

function stepLabel(step) {
  const seconds = ms => (ms / 1000).toLocaleString('es-MX');
  const duration = step.duracion_ms ? ` · ${seconds(step.duracion_ms)} s` : '';
  const pause = step.pausa_ms ? ` · pausa de ${seconds(step.pausa_ms)} s` : '';
  return commandLabel(step.comando) + duration + pause;
}

export class FaustoChat {
  constructor(document, api, vehicleId, { canExecute, onOpen, onRun, stop, onCatalogChange }) {
    Object.assign(this, { document, api, vehicleId, canExecute, onOpen, onRun, stop, onCatalogChange });
    this.dialog = document.getElementById('fausto-dialog');
    this.openButton = this.get('open');
    this.input = this.get('input');
    this.mic = this.get('mic');
    this.messages = this.get('messages');
    this.change = null;
    this.run = null;
    this.query = null;
    this.voice = new VoiceRecorder(seconds => {
      const recording = seconds !== null;
      this.mic.setAttribute('aria-pressed', String(recording));
      this.mic.setAttribute('aria-label', recording ? 'Terminar grabación' : 'Grabar voz');
      this.get('clock').textContent = recording ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
    });
  }

  get(id) { return this.document.getElementById('fausto-' + id); }

  start() {
    this.openButton.addEventListener('click', () => {
      this.onOpen();
      this.dialog.showModal();
    });
    this.get('close').addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('close', () => {
      this.voice.discard();
      this.query?.abort();
      this.voiceGesture = null;
      this.get('admin-key').value = '';
      this.setThinking(null);
      this.openButton.focus();
    });
    this.get('example').addEventListener('click', () => {
      this.input.value = this.get('example').textContent;
      this.input.focus();
    });
    this.get('form').addEventListener('submit', event => {
      event.preventDefault();
      const texto = this.input.value.trim();
      if (!texto || this.busy()) return;
      this.input.value = '';
      void this.interpret({ texto });
    });
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.get('form').requestSubmit();
      }
    });
    this.mic.disabled = !this.voice.supported;
    if (!this.voice.supported) this.mic.title = 'Micrófono no disponible en este navegador. Puedes escribir.';
    this.mic.addEventListener('pointerdown', event => this.beginMicGesture(event));
    this.mic.addEventListener('pointerup', event => this.endMicGesture(event));
    this.mic.addEventListener('pointercancel', event => this.endMicGesture(event, true));
    this.mic.addEventListener('lostpointercapture', event => this.endMicGesture(event, true));
    this.mic.addEventListener('contextmenu', event => event.preventDefault());
    this.mic.addEventListener('click', event => {
      // Teclado y tecnologías de asistencia activan el botón sin puntero.
      if (event.detail !== 0 || event.pointerType) return;
      if (this.voice.current) this.voice.stop();
      else void this.record();
    });
    this.get('confirmation').addEventListener('submit', event => {
      event.preventDefault();
      void this.confirmChange();
    });
    this.get('dismiss').addEventListener('click', () => this.renderChange(null));
    this.get('stop').addEventListener('click', () => void this.halt());
  }

  status(message) { this.get('status').textContent = message; }

  setRun(id) {
    this.run = id;
    this.onRun();
  }

  busy() { return this.query || this.voice.current || this.confirming; }

  updateInput() {
    this.get('send').disabled = Boolean(this.busy());
    this.mic.disabled = !this.voice.supported || Boolean(this.query || this.confirming);
  }

  setEffects(effects) {
    this.effects = effects;
    if (this.thinkingState) effects.thinking(this.thinkingState, this.thinkingElapsed);
  }

  setThinking(state) {
    if (state === 'working') this.thinkingStarted = performance.now();
    this.thinkingElapsed = state && state !== 'working' ? (performance.now() - this.thinkingStarted) / 1000 : undefined;
    this.thinkingState = state;
    this.get('thinking').hidden = state === null;
    this.get('thought-text').textContent = {
      working: 'Interpretando la orden…', ready: 'Interpretación lista', error: 'Interpretación interrumpida',
    }[state] ?? '';
    this.effects?.thinking(state, this.thinkingElapsed);
  }

  scrollLatest() { this.get('chat').scrollTop = this.get('chat').scrollHeight; }

  addMessage(message, user = false) {
    const item = this.document.createElement('p');
    item.className = 'fausto-message';
    item.toggleAttribute('data-user', user);
    item.textContent = message;
    this.messages.append(item);
    while (this.messages.childElementCount > 100) this.messages.firstElementChild.remove();
    this.get('example').hidden = true;
    this.scrollLatest();
  }

  beginMicGesture(event) {
    if (!event.isPrimary || event.button !== 0 || this.voiceGesture || this.query || this.confirming) return;
    const alreadyRecording = Boolean(this.voice.current);
    this.voiceGesture = { pointer: event.pointerId, start: performance.now(), alreadyRecording };
    this.mic.setPointerCapture(event.pointerId);
    if (!alreadyRecording) void this.record();
  }

  endMicGesture(event, cancelled = false) {
    const gesture = this.voiceGesture;
    if (event.pointerId !== gesture?.pointer) return;
    this.voiceGesture = null;
    if (cancelled) {
      if (!gesture.alreadyRecording) this.voice.discard();
    } else if (gesture.alreadyRecording || performance.now() - gesture.start >= HOLD_TO_TALK_MS) {
      this.voice.stop();
    }
  }

  async record() {
    if (this.busy()) return;
    this.get('send').disabled = true;
    this.status('Habla. Suelta si mantuviste pulsado o pulsa de nuevo para enviar.');
    try {
      const audio = await this.voice.record();
      if (audio && this.dialog.open) await this.interpret(audio);
    } catch (error) {
      const denied = ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'SecurityError'].includes(error.name);
      if (this.dialog.open) this.status(denied ? 'El micrófono no está disponible. Revisa el permiso o escribe la orden.' : error.message);
    } finally {
      this.updateInput();
    }
  }

  async interpret(source) {
    this.renderChange(null);
    this.status('');
    if (source.texto) this.addMessage(source.texto, true);
    const query = new AbortController();
    this.query = query;
    this.setThinking('working');
    this.scrollLatest();
    this.updateInput();
    let result;
    try {
      result = await this.api.interpretFausto(this.vehicleId, source, query.signal);
    } catch (error) {
      if (query.signal.aborted) return;
      const explanation = error.status === 404 || error.status === 503 ? 'Fausto.IA aún no está disponible en el servidor.'
        : error.status === 424 ? 'El proyecto de Google no tiene acceso a Gemini. Revisa el proyecto y su cuota en AI Studio.'
        : error.status === 502 ? 'Gemini no respondió. Revisa la configuración de AWS o vuelve a intentarlo.' : error.message;
      this.status(explanation);
    } finally {
      this.query = null;
      this.setThinking(query.signal.aborted ? null : result ? 'ready' : 'error');
      this.updateInput();
    }
    if (!result || query.signal.aborted || !this.dialog.open) return;
    if (!source.texto && result.transcripcion) this.addMessage(result.transcripcion, true);
    if (result.respuesta) this.addMessage(result.respuesta);
    if (result.cambio_catalogo) this.renderChange(result);
    else if (Array.isArray(result.pasos) && result.pasos.length) {
      this.addMessage(result.pasos.map(stepLabel).join('\n'));
      await this.executeMovement(result);
    }
  }

  renderChange(plan) {
    const change = plan?.cambio_catalogo;
    this.change = change && Object.hasOwn(CHANGES, change.accion) && plan.plan_id ? plan : null;
    this.get('confirmation').hidden = !this.change;
    this.get('admin-key').value = '';
    if (!this.change) return;
    this.get('change-title').textContent = `${CHANGES[change.accion]} · ${change.nombre}`;
    const details = [change.id ? `ID ${change.id}` : '', change.codigo != null ? `Código ${change.codigo}` : ''];
    if (change.total_pasos != null) details.push(`${change.total_pasos} pasos`);
    if (change.descripcion) details.push(change.descripcion);
    if (change.accion === 'crear_demo' && !change.pasos?.length) details.push('DEMO sin pasos');
    if (change.compatible_firmware === false) details.push('El firmware aún no reconoce este comando.');
    this.get('change-detail').textContent = details.filter(Boolean).join(' · ');
    const list = this.get('change-steps');
    list.replaceChildren();
    for (const step of change.pasos ?? []) {
      const item = this.document.createElement('li');
      item.textContent = stepLabel(step);
      list.append(item);
    }
    list.hidden = !list.childElementCount;
    this.scrollLatest();
  }

  async confirmChange() {
    if (!this.change || this.busy()) return;
    const plan = this.change;
    const input = this.get('admin-key');
    const key = input.value;
    input.value = '';
    this.confirming = true;
    this.get('confirm').disabled = true;
    this.get('dismiss').disabled = true;
    this.updateInput();
    this.status('Guardando el cambio…');
    try {
      const result = await this.api.confirmFaustoChange(this.vehicleId, plan.plan_id, key);
      if (result?.estado !== 'confirmado') throw new Error('No se pudo confirmar el resultado. Vuelve a cargar el catálogo.');
      this.renderChange(null);
      this.addMessage(result.mensaje || 'Cambio confirmado.');
      this.status('');
      this.onCatalogChange();
    } catch (error) {
      if (error.status === 404) {
        this.renderChange(null);
        this.status('La propuesta ya no está disponible. Vuelve a solicitar el cambio.');
      } else if (error.status === 401 || error.status === 403) {
        this.status('Introduce una clave de administrador válida para confirmar.');
      } else if (error.status === 409) {
        this.status('El catálogo tiene un conflicto. Revisa si el comando o la DEMO ya existen o están en uso.');
      } else {
        this.status(error.message);
      }
    } finally {
      this.confirming = false;
      this.get('confirm').disabled = false;
      this.get('dismiss').disabled = false;
      this.updateInput();
    }
  }

  async executeMovement(plan) {
    if (!plan.plan_id && plan.pasos.length === 1 && plan.pasos[0].comando === 'DETENER') {
      await this.halt();
      return;
    }
    if (!plan.plan_id || this.run || this.stopping || !this.canExecute()) {
      this.status('Conecta la API y WSS y espera a que termine la acción actual.');
      return;
    }
    this.setRun(plan.plan_id);
    this.status('Enviando recorrido…');
    try {
      await this.api.faustoPlan(this.vehicleId, plan.plan_id, 'ejecutar');
      if (this.run === plan.plan_id) this.status('Recorrido aceptado. Esperando eventos WSS…');
    } catch (error) {
      if (this.run !== plan.plan_id) return;
      if ([400, 401, 403, 404, 409, 422].includes(error.status)) {
        this.setRun(null);
        this.status(error.status === 404 ? 'El plan expiró. Vuelve a enviar la orden.' : 'El vehículo no pudo iniciar este plan.');
      } else {
        this.status('Inicio sin confirmar. Pulsa Detener para cancelar el plan.');
      }
    }
  }

  async halt() {
    if (this.stopping) return;
    this.stopping = true;
    const planId = this.run;
    this.query?.abort();
    this.voice.discard();
    this.status('Solicitando detención…');
    try {
      if (planId) {
        await this.api.faustoPlan(this.vehicleId, planId, 'cancelar');
        if (this.run === planId) this.setRun(null);
      } else if (!await this.stop()) {
        throw new Error('Detención sin confirmar');
      }
      this.status('Detención confirmada por la API.');
    } catch {
      this.status('Detención sin confirmar. Revisa la conexión e inténtalo de nuevo.');
    } finally {
      this.stopping = false;
    }
  }

  disconnect() {
    if (this.run) void this.halt();
  }

  handleEvent(event) {
    if (!this.run || event.fausto_id !== this.run) return;
    if (event.tipo === 'demo_movimiento') {
      this.status(`Paso ${event.orden} · ${commandLabel(event.comando)}`);
    } else if (TERMINAL.has(event.tipo)) {
      this.setRun(null);
      const statuses = { demo_fin: 'Recorrido terminado por el servidor.', demo_cancelada: 'Recorrido cancelado.', demo_error: 'El servidor informó un error durante el recorrido.' };
      this.addMessage(statuses[event.tipo]);
      this.status('');
    }
  }
}
