import { commandLabel } from '../domain/catalog.js';
import { VoiceRecorder } from './voice-recorder.js';

const TERMINAL = new Set(['demo_fin', 'demo_cancelada', 'demo_error']);

export class FaustoChat {
  constructor(document, api, vehicleId, { canExecute, onOpen, onRun, stop }) {
    Object.assign(this, { document, api, vehicleId, canExecute, onOpen, onRun, stop });
    this.dialog = document.getElementById('fausto-dialog');
    this.openButton = this.get('open');
    this.input = this.get('input');
    this.mic = this.get('mic');
    this.messages = this.get('messages');
    this.plan = null;
    this.run = null;
    this.query = null;
    this.voice = new VoiceRecorder(seconds => {
      const recording = seconds !== null;
      this.mic.setAttribute('aria-pressed', String(recording));
      this.mic.setAttribute('aria-label', recording ? 'Terminar grabación' : 'Grabar voz');
      this.get('clock').textContent = recording ? `0:${String(seconds).padStart(2, '0')}` : '';
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
      this.openButton.focus();
    });
    this.get('example').addEventListener('click', () => {
      this.input.value = this.get('example').textContent;
      this.input.focus();
    });
    this.get('form').addEventListener('submit', event => {
      event.preventDefault();
      const texto = this.input.value.trim();
      if (!texto || this.voice.current || this.query) return;
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
    this.mic.addEventListener('click', () => void this.record());
    this.get('execute').addEventListener('click', () => void this.execute());
    this.get('stop').addEventListener('click', () => void this.halt());
  }

  status(message) { this.get('status').textContent = message; }

  setRun(id) {
    this.run = id;
    this.get('execute').disabled = Boolean(id);
    this.onRun();
  }

  addMessage(message, user = false) {
    const item = this.document.createElement('p');
    item.className = 'fausto-message';
    item.toggleAttribute('data-user', user);
    item.textContent = message;
    this.messages.append(item);
    while (this.messages.childElementCount > 18) this.messages.firstElementChild.remove();
    this.get('chat').scrollTop = this.get('chat').scrollHeight;
  }

  async record() {
    if (this.voice.current) { this.voice.stop(); return; }
    if (this.query) return;
    this.get('send').disabled = true;
    this.status('Habla y vuelve a pulsar el micrófono para enviar.');
    try {
      const audio = await this.voice.record();
      if (audio && this.dialog.open) await this.interpret(audio);
    } catch {
      if (this.dialog.open) this.status('El micrófono no está disponible. Revisa el permiso o escribe la orden.');
    } finally {
      this.get('send').disabled = Boolean(this.query);
    }
  }

  async interpret(source) {
    this.renderPlan(null);
    this.status('');
    if (source.texto) this.addMessage(source.texto, true);
    const query = new AbortController();
    this.query = query;
    this.get('thinking').hidden = false;
    this.get('send').disabled = true;
    this.mic.disabled = true;
    try {
      const result = await this.api.interpretFausto(this.vehicleId, source, query.signal);
      if (query.signal.aborted || !this.dialog.open) return;
      if (!source.texto && result.transcripcion) this.addMessage(result.transcripcion, true);
      if (result.respuesta) this.addMessage(result.respuesta);
      if (Array.isArray(result.pasos) && result.pasos.length) this.renderPlan(result);
    } catch (error) {
      if (query.signal.aborted) return;
      const explanation = error.status === 404 || error.status === 503 ? 'Fausto.IA aún no está disponible en el servidor.'
        : error.status === 424 ? 'El proyecto de Google no tiene acceso a Gemini. Revisa el proyecto y su cuota en AI Studio.'
        : error.status === 502 ? 'Gemini no respondió. Revisa la configuración de AWS o vuelve a intentarlo.' : error.message;
      this.status(explanation);
    } finally {
      this.query = null;
      this.get('thinking').hidden = true;
      this.get('send').disabled = false;
      this.mic.disabled = !this.voice.supported;
    }
  }

  renderPlan(plan) {
    this.plan = plan;
    this.get('example').hidden = Boolean(plan) || this.messages.childElementCount > 1;
    const list = this.get('steps');
    list.replaceChildren();
    for (const step of plan?.pasos ?? []) {
      const item = this.document.createElement('li');
      item.textContent = commandLabel(step.comando) +
        (step.duracion_ms ? ` · ${(step.duracion_ms / 1000).toLocaleString('es-MX')} s` : '');
      list.append(item);
    }
    this.get('plan').hidden = !plan;
    this.get('chat').scrollTop = this.get('chat').scrollHeight;
  }

  async execute() {
    if (!this.plan || this.run) return;
    const plan = this.plan;
    if (!plan.plan_id && plan.pasos.length === 1 && plan.pasos[0].comando === 'DETENER') {
      this.renderPlan(null);
      await this.halt();
      return;
    }
    if (!this.canExecute()) {
      this.status('Conecta la API y WSS y espera a que termine la acción actual.');
      return;
    }
    this.renderPlan(null);
    this.setRun(plan.plan_id);
    this.status('Enviando recorrido…');
    try {
      await this.api.faustoPlan(this.vehicleId, plan.plan_id, 'ejecutar');
      if (this.run === plan.plan_id) this.status('Recorrido aceptado. Esperando eventos WSS…');
    } catch (error) {
      if (this.run !== plan.plan_id) return;
      if (error.status === 404 || error.status === 409) {
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
    this.renderPlan(null);
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
      this.status(statuses[event.tipo]);
    }
  }
}
