import { formatServerTime, MONITOR_ZONE_LABEL } from '../domain/monitor-data.js';

/** DOM seguro y paginación visual. Cambiar página no modifica registros en RDS. */
export class MonitorView {
  constructor(document, { pageSize = 10 } = {}) {
    this.document = document;
    this.pageSize = pageSize;
    this.page = 0;
    this.snapshot = null;
    this.rowsSignature = '';
    this.get('history-prev')?.addEventListener('click', () => this.go(-1));
    this.get('history-next')?.addEventListener('click', () => this.go(1));
  }

  get(id) { return this.document.getElementById(id); }
  text(id, text) { const node = this.get(id); if (node) node.textContent = text; }
  setPageSize(size) {
    if (!Number.isInteger(size) || size < 1 || size > 10 || this.pageSize === size) return;
    this.pageSize = size;
    this.page = 0;
    if (this.snapshot) this.render(this.snapshot);
  }

  go(delta) {
    if (!this.snapshot) return;
    const pages = Math.max(1, Math.ceil(this.snapshot.records.length / this.pageSize));
    this.page = Math.max(0, Math.min(pages - 1, this.page + delta));
    this.render(this.snapshot);
  }

  render(snapshot) {
    this.snapshot = snapshot;
    const latest = snapshot.latest;
    const when = formatServerTime(latest?.epoch ?? null);
    this.text('monitor-command', latest?.label ?? 'Sin movimientos');
    this.text('monitor-vehicle', latest ? `${latest.vehicle} · #${latest.vehicleId}` : 'Vehículo sin estado reportado');
    this.text('monitor-date', when.date);
    this.text('monitor-time', when.time);
    this.text('monitor-code', latest?.code != null ? `Código ${latest.code}` : 'Sin código');
    this.text('monitor-source', latest ? `${latest.source}${latest.timeKind === 'evento' ? ' · hora del evento' : ''}` : 'Esperando datos');
    this.text('monitor-zone', MONITOR_ZONE_LABEL);
    const offline = snapshot.socket !== 'connected';
    let status = snapshot.eventLabel || 'Último estado reportado';
    if (snapshot.stateStatus === 'loading') status = latest ? 'Actualizando estado…' : 'Consultando estado…';
    if (snapshot.stateStatus === 'error') status = `${latest ? 'Último dato conocido. ' : ''}${snapshot.stateError}`;
    else if (offline && latest) status = 'Último dato conocido · WSS sin conexión';
    else if (!latest && snapshot.stateStatus === 'ready') status = 'Sin movimientos reportados';
    this.text('monitor-state-status', status);
    const stateNode = this.get('monitor-state-status');
    if (stateNode) stateNode.dataset.state = snapshot.stateStatus === 'error' || offline ? 'stale' : 'current';
    this.renderHistory(snapshot);
  }

  renderHistory(snapshot) {
    const records = snapshot.records;
    const pages = Math.max(1, Math.ceil(records.length / this.pageSize));
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const first = this.page * this.pageSize;
    const visible = records.slice(first, first + this.pageSize);
    const body = this.get('monitor-history-body');
    // Un paso de DEMO puede cambiar la tarjeta sin reconstruir una tabla idéntica.
    const signature = JSON.stringify([first, visible, visible.length ? '' : snapshot.historyStatus]);
    if (body && signature !== this.rowsSignature) {
      this.rowsSignature = signature;
      const rows = visible.map((record, index) => {
        const row = this.document.createElement('tr');
        row.dataset.recordId = String(record.id);
        const time = formatServerTime(record.epoch);
        const values = [String(first + index + 1).padStart(2, '0'), record.label, time.date, time.time];
        for (const value of values) {
          const cell = this.document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        row.title = `Registro ${record.id} · ${record.origin}${record.code == null ? '' : ` · código ${record.code}`}`;
        return row;
      });
      if (!rows.length) {
        const row = this.document.createElement('tr');
        const cell = this.document.createElement('td');
        cell.colSpan = 4;
        cell.className = 'history-empty';
        cell.textContent = snapshot.historyStatus === 'loading' ? 'Cargando historial…'
          : snapshot.historyStatus === 'error' ? 'Historial no disponible' : 'Sin registros';
        row.append(cell);
        rows.push(row);
      }
      body.replaceChildren(...rows);
    }
    this.text('monitor-count', String(records.length));
    this.text('history-page', `${this.page + 1} / ${pages}`);
    const prev = this.get('history-prev');
    const next = this.get('history-next');
    if (prev) prev.disabled = this.page === 0;
    if (next) next.disabled = this.page >= pages - 1;
    let status = records.length ? 'Registros individuales confirmados por la API' : 'Sin movimientos individuales';
    if (snapshot.historyStatus === 'loading') status = 'Consultando historial en RDS…';
    else if (snapshot.historyStatus === 'error') status = `${records.length ? 'Últimos registros conocidos. ' : ''}${snapshot.historyError}`;
    else if (snapshot.socket !== 'connected' && records.length) status = 'Últimos registros conocidos · WSS sin conexión';
    this.text('monitor-history-status', status);
  }
}
