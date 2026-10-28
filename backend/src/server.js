// CholloGarde · servidor local (Fase 2).
// Sirve el dashboard, expone la API REST, emite eventos en tiempo real y ejecuta el motor de rastreo.
import express from 'express';
import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import { config } from './config.js';
import * as store from './store.js';
import { bus, log, recentLogs } from './bus.js';
import { hostStats } from './http.js';
import { engine } from './engine.js';
import * as games from './games.js';
import { parseUrl, shopFor } from './sources/shops.js';
import { norm } from './sources/keyshops.js';
import { close as closeBrowser } from './sources/browser.js';
import { dispatch, send, SAMPLE } from './notify/index.js';

const VERSION = '0.3.0';

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
    res.status(user ? 400 : 502).json({ error: user ? e.message : `No se pudo completar: ${e.message}` });
  });

  const sources = () => {
    const stats = new Map(hostStats().map(s => [s.host, s]));
    const row = (name, kind, covers, host) => {
      const s = stats.get(host) || {};
      return { name, kind, covers, host, ok: s.runs ? Math.round((1 - s.fails / s.runs) * 100) : null, lat: s.lat || null, last: s.last || null, status: s.runs ? s.status : 'idle', runs: s.runs || 0 };
    };
    const base = [
      row('Instant Gaming', 'búsqueda', 'Keys · búsqueda automática por nombre', 'www.instant-gaming.com'),
      row('Eneba', 'navegador', 'Keys · búsqueda automática por nombre', 'www.eneba.com'),
      row('Steam España', 'API web', 'Precio oficial de PC, reseñas, Steam Deck', new URL(config.steamStoreBase).hostname)
    ];
    // Las tiendas de los enlaces pegados (Amazon, MediaMarkt, GAME, Impact…) aparecen según se usan.
    const known = new Set(base.map(b => b.host));
    const linked = new Map();
    for (const t of db().trackers) for (const l of t.links || []) {
      const u = parseUrl(l); if (!u || known.has(u.hostname) || linked.has(u.hostname)) continue;
      const sh = shopFor(u);
      linked.set(u.hostname, row(sh.name, sh.browser ? 'navegador' : 'ficha web', 'Enlaces de producto', u.hostname));
    }
    return [...base, ...linked.values()];
  };

  app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION, mode: 'live' }));

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
    const b = req.body || {};
    if (b.cat && b.cat !== 'game') throw new games.UserError('De momento solo hay fuente real para videojuegos. Productos y vuelos llegarán en las próximas fases.');
    const it = await games.createTracker(b);
    const key = t => `${norm(t.title)}|${t.platform || 'PC'}`;
    const dup = db().trackers.find(t => t.cat === 'game' && t.live && key(t) === key(it));
    if (dup) throw new games.UserError(`Ya sigues «${dup.title}». Cambia su objetivo desde su ficha.`);
    db().trackers.unshift(it);
    store.save();
    log('ok', 'api', `tracker creado: «${it.title}» · objetivo ${it.target} €`);
    bus.emit('event', 'tracker', it);
    res.status(201).json(it);
    // Si ya está por debajo del objetivo, avisa ya.
    if (it.alert && it.current <= it.target) { it.alerted = true; store.save(); dispatch(it); }
  }));

  app.patch('/api/trackers/:id', wrap(async (req, res) => {
    const it = find(req.params.id);
    if (!it) return res.status(404).json({ error: 'Ese tracker no existe' });
    const b = req.body || {};
    let fire = false;
    if (b.target !== undefined) {
      if (!(+b.target > 0)) throw new games.UserError('El objetivo tiene que ser mayor que 0.');
      it.target = Math.round(+b.target * 100) / 100;
      it.alerted = false;
      fire = true;
    }
    if (b.alert !== undefined) { it.alert = !!b.alert; if (it.alert) { it.alerted = false; fire = true; } }
    const rescan = it.cat === 'game' && it.live && (b.links !== undefined || b.keys !== undefined);
    if (rescan) games.updateSources(it, b);
    store.save();
    bus.emit('event', 'tracker', it);
    res.json(it);
    if (rescan) { log('info', 'api', `«${it.title}»: tiendas actualizadas, comprobando precios`); engine.cycle(it.id).catch(() => {}); return; }
    if (fire && it.alert && it.current <= it.target) { it.alerted = true; store.save(); dispatch(it); }
  }));

  app.delete('/api/trackers/:id', (req, res) => {
    const it = find(req.params.id);
    if (!it) return res.status(404).json({ error: 'Ese tracker no existe' });
    db().trackers = db().trackers.filter(t => t.id !== it.id);
    store.save();
    log('warn', 'api', `tracker eliminado: «${it.title}»`);
    bus.emit('event', 'tracker-removed', { id: it.id });
    res.json({ ok: true });
  });

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

  // Fase 3: aquí se conectará Gemini. Mientras tanto el dashboard usa sus heurísticas locales.
  app.post('/api/ai/:task', (req, res) => res.status(501).json({ error: 'La IA con Gemini llega en la Fase 3.' }));

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
