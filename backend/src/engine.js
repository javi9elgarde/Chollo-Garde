// Motor de rastreo: cada X minutos revisa todos los trackers, guarda el histórico,
// avisa al dashboard en tiempo real y dispara las alertas al llegar al objetivo.
import * as games from './games.js';
import { get, save } from './store.js';
import { log, emit } from './bus.js';
import { dispatch, isAtl } from './notify/index.js';

const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REFRESHERS = { game: games.refresh };

export const engine = {
  timer: null, nextAt: 0, busy: false, pending: new Set(),

  status() {
    const db = get();
    return { running: !!this.timer, busy: this.busy, nextAt: this.timer ? this.nextAt : null, intervalMin: db.settings.intervalMin, cycles: db.stats.cycles, requests: db.stats.requests };
  },
  emitStatus() { emit('engine', this.status()); },

  // Al encender el PC la red puede tardar en estar lista: primer ciclo a los 15 s.
  start({ firstInMs = 15000 } = {}) {
    this.stop({ silent: true });
    if (!get().settings.engine) { this.emitStatus(); return; }
    const schedule = ms => {
      this.nextAt = Date.now() + ms;
      this.timer = setTimeout(async () => {
        const r = await this.cycle();
        // Si fallaron todos (sin conexión, API caída…), se reintenta en 5 minutos en vez de esperar al intervalo.
        const allFailed = r && r.failed > 0 && r.ok === 0;
        if (allFailed) log('warn', 'cron', 'no se pudo consultar ningún precio; reintento en 5 min');
        if (this.timer) schedule(allFailed ? 5 * 60e3 : get().settings.intervalMin * 60e3);
      }, ms);
      this.emitStatus();
    };
    schedule(firstInMs);
  },
  stop({ silent = false } = {}) {
    clearTimeout(this.timer); this.timer = null;
    if (!silent) this.emitStatus();
  },

  async cycle(onlyId = null) {
    if (this.busy) {
      // Una comprobación pedida desde el panel se hace en cuanto acabe el ciclo en marcha.
      if (onlyId) this.pending.add(onlyId);
      else log('warn', 'cron', 'ya hay un ciclo en marcha; se espera a que termine');
      return;
    }
    const db = get();
    const list = db.trackers.filter(t => (!onlyId || t.id === onlyId) && REFRESHERS[t.cat] && t.live);
    if (!list.length) { if (!onlyId) log('info', 'cron', 'no hay trackers con fuente real todavía'); return; }
    this.busy = true;
    db.stats.cycles++;
    this.emitStatus();
    log('info', 'cron', `ciclo #${db.stats.cycles} · ${list.length} tracker${list.length > 1 ? 's' : ''}`);
    const res = { ok: 0, failed: 0 };
    try {
      for (const [i, it] of list.entries()) {
        if (i) await sleep(1200); // sin prisas: las APIs son gratuitas y conviene no saturarlas
        res[(await this.check(it)) ? 'ok' : 'failed']++;
      }
      return res;
    } finally {
      this.busy = false;
      save();
      this.emitStatus();
      const next = [...this.pending][0];
      if (next) { this.pending.delete(next); setTimeout(() => this.cycle(next).catch(() => {}), 0); }
    }
  },

  async check(it) {
    const t0 = Date.now();
    try {
      const wasAtl = isAtl(it);
      const r = await REFRESHERS[it.cat](it);
      const secs = ((Date.now() - t0) / 1000).toFixed(2);
      if (r.current !== r.old) log(r.current < r.old ? 'ok' : 'info', 'parser', `${it.title}: ${EUR.format(r.old)} → ${EUR.format(r.current)} en ${r.best.name} · ${secs} s`);
      else log('info', 'parser', `${it.title}: sin cambios (${EUR.format(r.current)} en ${r.best.name}) · ${secs} s`);
      emit('tracker', it);
      if (it.current > it.target * 1.02) it.alerted = false;
      if (it.alert && !it.alerted && it.current <= it.target) {
        it.alerted = true;
        save();
        await dispatch(it);
      } else if (!wasAtl && isAtl(it) && r.current < r.old) {
        log('ok', 'parser', `nuevo mínimo histórico: ${it.title} a ${EUR.format(it.current)}`);
      }
      return true;
    } catch (e) {
      it.lastError = e.message; it.lastCheck = Date.now();
      log('err', it.source || 'fuente', `${it.title}: ${e.message}`);
      emit('tracker', it);
      return false;
    } finally {
      save();
    }
  }
};
