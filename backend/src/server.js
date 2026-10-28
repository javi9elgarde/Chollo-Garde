// CholloGarde · servidor local (Fase 2).
// Sirve el dashboard, expone la API REST, emite eventos en tiempo real y ejecuta el motor de rastreo.
import express from 'express';
import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import { config } from './config.js';
import * as store from './store.js';
import { bus, log, recentLogs } from './bus.js';
import { engine } from './engine.js';
import * as games from './games.js';
import * as actions from './actions.js';
import * as ai from './ai.js';
import { close as closeBrowser } from './sources/browser.js';
import { dispatch, send, SAMPLE } from './notify/index.js';

const VERSION = '0.4.0';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  // Solo se aceptan peticiones dirigidas a este PC y hechas desde el propio panel: así una web
  // cualquiera que visites no puede tocar tus ajustes (DNS rebinding / CSRF contra localhost).
  const localOnly = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  const extraHosts = (process.env.ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  app.use((req, res, next) => {
    const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    if (localOnly && !['127.0.0.1', 'localhost', '[::1]', ...extraHosts].includes(host)) return res.status(403).send('Host no permitido');
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && origin !== 'null') {
      let oh = '';
      try { oh = new URL(origin).host.toLowerCase(); } catch {}
      if (oh !== (req.headers.host || '').toLowerCase()) return res.status(403).json({ error: 'Origen no permitido' });
    }
    next();
  });

  // Contraseña opcional (necesaria si abres el panel fuera de este PC). El navegador la pide una vez.
  if (config.password) {
    app.use((req, res, next) => {
      const [type, b64] = (req.headers.authorization || '').split(' ');
      const pass = type === 'Basic' && b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
      const a = Buffer.from(pass), b = Buffer.from(config.password);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
      res.set('WWW-Authenticate', 'Basic realm="CholloGarde", charset="UTF-8"').status(401).send('Contraseña necesaria');
    });
  }

  const db = () => store.get();
  const find = id => db().trackers.find(t => t.id === id);
  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
    const user = e instanceof games.UserError;
    if (!user) log('err', 'api', `${req.method} ${req.path}: ${e.message}`);
    res.status(e instanceof actions.NotFound ? 404 : user ? 400 : 502).json({ error: user ? e.message : `No se pudo completar: ${e.message}` });
  });

  const sources = actions.sourceRows;

  app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION, mode: 'live' }));
  app.get('/api/shops', (req, res) => res.json({ keys: games.KEY_NAMES, retail: games.SHOP_NAMES.filter(n => !games.KEY_NAMES.includes(n)), platforms: games.PLATFORMS }));

  app.get('/api/state', (req, res) => res.json({
    version: VERSION,
    trackers: db().trackers, alerts: db().alerts,
    settings: store.publicSettings(), engine: engine.status(),
    logs: recentLogs(), sources: sources()
  }));

  // Tiempo real: Server-Sent Events. El navegador se reconecta solo si se corta.
  app.get('/api/stream', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const onEvent = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    bus.on('event', onEvent);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); bus.off('event', onEvent); });
  });

  app.get('/api/sources', (req, res) => res.json(sources()));
  app.get('/api/trackers', (req, res) => res.json(db().trackers));

  app.post('/api/fetch-meta', wrap(async (req, res) => {
    const m = await games.preview(req.body || {});
    const bad = m.stores.filter(s => s.error).length;
    log('info', 'fetch-meta', `«${m.title}» ${m.price.toFixed(2)} € en ${m.store} · ${m.stores.length - bad}/${m.stores.length} tiendas con precio`);
    res.json(m);
  }));

  app.post('/api/trackers', wrap(async (req, res) => {
    const { it, notify } = await actions.addTracker(req.body || {});
    res.status(201).json(it);
    notify();
  }));

  app.patch('/api/trackers/:id', wrap(async (req, res) => {
    const { it, rescan, notify } = actions.editTracker(req.params.id, req.body || {});
    res.json(it);
    if (rescan) engine.cycle(it.id).catch(() => {});
    else notify();
  }));

  app.delete('/api/trackers/:id', wrap(async (req, res) => {
    actions.removeTracker(req.params.id);
    res.json({ ok: true });
  }));

  app.post('/api/trackers/:id/scan', wrap(async (req, res) => {
    if (!find(req.params.id)) return res.status(404).json({ error: 'Ese tracker no existe' });
    res.json({ ok: true });
    engine.cycle(req.params.id).catch(() => {});
  }));

  app.post('/api/engine', wrap(async (req, res) => {
    const a = req.body?.action;
    if (a === 'start' || a === 'stop') {
      store.updateSettings({ engine: a === 'start' });
      a === 'start' ? engine.start({ firstInMs: 1000 }) : engine.stop();
      log('info', 'cron', a === 'start' ? 'motor reanudado' : 'motor en pausa');
    } else if (a === 'run') {
      res.json(engine.status());
      engine.cycle().catch(() => {});
      return;
    } else throw new games.UserError('Acción desconocida');
    res.json(engine.status());
  }));

  app.get('/api/settings', (req, res) => res.json(store.publicSettings()));
  app.put('/api/settings', (req, res) => {
    const before = store.get().settings.intervalMin;
    const s = store.updateSettings(req.body || {});
    if (s.intervalMin !== before && engine.timer) engine.start({ firstInMs: s.intervalMin * 60e3 });
    bus.emit('event', 'settings', s);
    res.json(s);
  });

  app.post('/api/notify/test', wrap(async (req, res) => {
    const ch = req.body?.channel || 'all';
    const it = db().trackers.find(t => t.id === req.body?.id) || db().trackers[0] || SAMPLE;
    if (ch === 'all') return res.json(await dispatch(it, { reason: 'test' }));
    if (!['telegram', 'discord', 'email'].includes(ch)) throw new games.UserError('Canal desconocido');
    const out = await send(it, { only: ch, test: true });
    const r = out[ch];
    res.status(r === 'ok' ? 200 : 400).json({ channel: ch, result: r, error: r === 'ok' ? null : r.replace(/^error: /, '') });
  }));

  app.post('/api/alerts/read', (req, res) => {
    db().alerts.forEach(a => { a.read = true; });
    store.save();
    res.json({ ok: true });
  });

  // Fase 3 · Gemini. «analizar» rehace el análisis de un tracker; «chat» (Co-Piloto y comparador) reenvía
  // a Gemini el prompt y los datos que manda el panel. Sin GEMINI_API_KEY responde 501 y el panel usa su heurística.
  app.post('/api/ai/:task', wrap(async (req, res) => {
    if (!ai.enabled()) return res.status(501).json({ error: 'Pon GEMINI_API_KEY en backend/.env y reinicia para usar Gemini.' });
    const b = req.body || {};
    if (req.params.task === 'analizar') {
      const it = find(b.id);
      if (!it) return res.status(404).json({ error: 'Ese tracker no existe' });
      const r = await ai.refresh([it], { force: true });
      store.save();
      bus.emit('event', 'tracker', it);
      if (r && !r.ok) throw new games.UserError(r.error);
      return res.json(it);
    }
    if (req.params.task === 'chat') {
      try { return res.json(await ai.chat({ system: String(b.system || ''), prompt: String(b.prompt || ''), history: Array.isArray(b.history) ? b.history : [], json: !!b.json })); }
      catch (e) { throw e instanceof ai.AiError ? new games.UserError(e.message) : e; }
    }
    throw new games.UserError('Tarea de IA desconocida');
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  app.use(express.static(config.frontendDir, { index: 'index.html', maxAge: 0 }));
  return app;
}

export function start() {
  store.load();
  if (store.get().trackers.filter(games.migrate).length) store.save();
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    log('info', 'boot', `CholloGarde ${VERSION} escuchando en ${url} · ${store.get().trackers.length} trackers`);
    if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.password && !process.env.IN_DOCKER) log('warn', 'boot', 'El panel está abierto a la red sin contraseña. Pon DASHBOARD_PASSWORD en backend/.env.');
    engine.start();
    if (config.openBrowser) {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error(`El puerto ${config.port} ya está en uso. ¿CholloGarde ya está abierto? Prueba http://localhost:${config.port}`);
    else console.error(e);
    process.exit(1);
  });
  const bye = async () => { store.save({ now: true }); await closeBrowser(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  return server;
}
