/** API y RDS se comprueban por separado. WSS pertenece a SocketClient. */
export class HealthService {
  constructor(api, { onChange = () => {}, intervalMs = 20000 } = {}) {
    this.api = api;
    this.onChange = onChange;
    this.intervalMs = Math.max(5000, intervalMs);
    this.state = { api: 'checking', rds: 'unverified' };
    this.running = false;
    this.generation = 0;
    this.inFlight = null;
    this.timer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.check();
  }

  stop() {
    this.running = false;
    this.generation += 1;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.inFlight = null;
  }

  update(patch, generation) {
    if (generation !== this.generation) return;
    this.state = { ...this.state, ...patch };
    this.onChange({ ...this.state });
  }

  check() {
    if (this.inFlight) return this.inFlight;
    clearTimeout(this.timer);
    const generation = this.generation;
    this.controller = new AbortController();
    const options = { signal: this.controller.signal };
    this.update({ api: 'checking', rds: 'unverified' }, generation);
    const apiCheck = Promise.resolve().then(() => this.api.health(options)).then(
      data => this.update({ api: data?.status === 'ok' ? 'available' : 'unavailable' }, generation),
      () => this.update({ api: 'unavailable' }, generation),
    );
    const databaseCheck = Promise.resolve().then(() => this.api.rdsHealth(options)).then(
      data => this.update({ rds: data?.status === 'ok' && data.database === 'RDS' ? 'available' : 'unverified' }, generation),
      error => this.update({ rds: error?.status === 503 && error.diagnostic === true ? 'unavailable' : 'unverified' }, generation),
    );
    const operation = Promise.allSettled([apiCheck, databaseCheck]).finally(() => {
      if (generation !== this.generation) return;
      this.inFlight = null;
      if (this.running) this.timer = setTimeout(() => this.check(), this.intervalMs);
    });
    this.inFlight = operation;
    return operation;
  }
}
