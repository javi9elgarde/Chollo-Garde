// Prueba de extremo a extremo con APIs externas simuladas (CheapShark, Steam, cambio, Telegram, Discord).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const up = { usd: 19.99, steamEur: 29.5, telegram: [], discord: [] };

const upstream = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const p = u.pathname;
    if (p === '/cs/stores') return json([{ storeID: '1', storeName: 'Steam', isActive: 1 }, { storeID: '15', storeName: 'Fanatical', isActive: 1 }, { storeID: '7', storeName: 'GOG', isActive: 1 }, { storeID: '99', storeName: 'Cerrada', isActive: 0 }]);
    if (p === '/cs/games' && u.searchParams.get('title')) return json(u.searchParams.get('title') === 'nada' ? [] : [{ gameID: '612', steamAppID: '1145350', external: 'Hades II', thumb: 'https://x/t.jpg', cheapest: '19.99' }, { gameID: '613', steamAppID: '1145360', external: 'Hades', thumb: 'https://x/h.jpg' }]);
    if (p === '/cs/games' && u.searchParams.get('steamAppID')) return json([{ gameID: '612', steamAppID: u.searchParams.get('steamAppID'), external: 'Hades II' }]);
    if (p === '/cs/games' && u.searchParams.get('id')) return json({ info: { title: 'Hades II', steamAppID: '1145350', thumb: 'https://x/t.jpg' }, cheapestPriceEver: { price: '17.49', date: 1717000000 },
      deals: [{ storeID: '1', dealID: 'd1', price: '29.99', retailPrice: '29.99' }, { storeID: '15', dealID: 'abc%3D', price: String(up.usd), retailPrice: '29.99' }, { storeID: '7', dealID: 'd7', price: '24.99', retailPrice: '29.99' }, { storeID: '99', dealID: 'd99', price: '1.00', retailPrice: '29.99' }] });
    if (p === '/steam/api/appdetails') {
      const id = u.searchParams.get('appids');
      return json({ [id]: { success: true, data: { name: 'Hades II', header_image: 'https://cdn/h.jpg', is_free: false, genres: [{ description: 'Acción' }], metacritic: { score: 95 }, developers: ['Supergiant Games'], release_date: { date: '25 sep 2025' }, price_overview: { currency: 'EUR', initial: 2950, final: Math.round(up.steamEur * 100), discount_percent: 0 } } } });
    }
    if (p.startsWith('/steam/appreviews/')) return json({ success: 1, query_summary: { review_score_desc: 'Extremadamente positivas', total_positive: 96, total_negative: 4, total_reviews: 100 } });
    if (p === '/steam/saleaction/ajaxgetdeckappcompatibilityreport') return json({ results: { resolved_category: 3 } });
    if (p === '/fx') return json({ rates: { EUR: 0.9 } });
    if (p.startsWith('/tg/bot')) { up.telegram.push({ method: p.split('/').pop(), body: JSON.parse(body) }); return json({ ok: true }); }
    if (p === '/discord') { up.discord.push(JSON.parse(body)); res.writeHead(204); return res.end(); }
    json({ error: 'no mock ' + p }, 404);
  });
});

let base, server, tmp;
before(async () => {
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const ub = `http://127.0.0.1:${upstream.address().port}`;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  Object.assign(process.env, {
    DATA_DIR: tmp, CHEAPSHARK_BASE: ub + '/cs', STEAM_STORE_BASE: ub + '/steam', FX_URL: ub + '/fx', TELEGRAM_API_BASE: ub + '/tg',
    TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42', DISCORD_WEBHOOK_URL: ub + '/discord', SMTP_USER: '', SMTP_PASS: ''
  });
  const store = await import('../src/store.js');
  const { createApp } = await import('../src/server.js');
  store.load();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); upstream.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const call = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const wait = async (fn, ms = 4000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 50)); } };

test('estado inicial y ajustes sin secretos', async () => {
  const { body } = await call('GET', '/api/state');
  assert.deepEqual(body.trackers, []);
  assert.equal(body.settings.telegram.tokenSet, true);
  assert.equal(body.settings.telegram.token, undefined);
  assert.equal(body.settings.discord.url, undefined);
});

test('fetch-meta por nombre: precios en EUR, Steam España manda sobre el de EE. UU.', async () => {
  const { status, body } = await call('POST', '/api/fetch-meta', { q: 'hades' });
  assert.equal(status, 200);
  assert.equal(body.title, 'Hades II');
  assert.equal(body.store, 'Fanatical');
  assert.equal(body.price, 17.99); // 19.99 USD * 0.9
  assert.equal(body.approx, true);
  const steam = body.stores.find(s => s.name === 'Steam');
  assert.deepEqual([steam.price, steam.approx], [29.5, false]);
  assert.ok(!body.stores.some(s => s.name === 'Cerrada'));
  assert.equal(body.candidates.length, 2);
});

test('fetch-meta: enlace de Steam y errores claros', async () => {
  const ok = await call('POST', '/api/fetch-meta', { url: 'https://store.steampowered.com/app/1145350/Hades_II/' });
  assert.equal(ok.body.steamAppID, '1145350');
  const other = await call('POST', '/api/fetch-meta', { url: 'https://www.eneba.com/es/steam-hades-ii' });
  assert.equal(other.status, 400);
  assert.match(other.body.error, /eneba/);
  const none = await call('POST', '/api/fetch-meta', { q: 'nada' });
  assert.equal(none.status, 400);
});

let id;
test('crear tracker, detectar duplicado y rechazar categorías sin fuente', async () => {
  const r = await call('POST', '/api/trackers', { gameID: '612', steamAppID: '1145350', target: 15 });
  assert.equal(r.status, 201);
  id = r.body.id;
  assert.equal(r.body.current, 17.99);
  assert.equal(r.body.msrp, 29.5);
  assert.equal(r.body.deck, 'Verificado');
  assert.equal(r.body.reviews.rating, 4.8);
  assert.equal(r.body.atlEver.p, 15.74);
  assert.equal(r.body.history.length, 1);
  assert.equal((await call('POST', '/api/trackers', { gameID: '612', target: 10 })).status, 400);
  assert.equal((await call('POST', '/api/trackers', { cat: 'product', target: 10 })).status, 400);
});

test('el motor actualiza el precio y dispara Telegram y Discord al llegar al objetivo', async () => {
  up.usd = 16.0; // 14.40 € < 15 € objetivo
  const r = await call('POST', `/api/trackers/${id}/scan`);
  assert.equal(r.status, 200);
  await wait(async () => (await call('GET', '/api/state')).body.alerts.length === 1);
  const { body } = await call('GET', '/api/state');
  const it = body.trackers[0];
  assert.equal(it.current, 14.4);
  assert.equal(it.alerted, true);
  assert.equal(it.history.length, 1, 'mismo día: se actualiza el punto, no se duplica');
  assert.deepEqual(body.alerts[0].channels, { web: true, telegram: 'ok', discord: 'ok', email: 'off' });
  assert.equal(up.telegram.at(-1).method, 'sendPhoto');
  assert.match(up.telegram.at(-1).body.caption, /Hades II/);
  assert.equal(up.discord.at(-1).embeds[0].title, 'Hades II');
  // Sin bajar más, no se repite la alerta.
  await call('POST', `/api/trackers/${id}/scan`);
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await call('GET', '/api/state')).body.alerts.length, 1);
});

test('cambiar objetivo, ajustes y prueba de canal', async () => {
  const p = await call('PATCH', `/api/trackers/${id}`, { target: 12, alert: true });
  assert.equal(p.body.target, 12);
  assert.equal(p.body.alerted, false);
  const s = await call('PUT', '/api/settings', { telegram: { enabled: true, chatId: '7', token: '' }, intervalMin: 2 });
  assert.equal(s.body.telegram.tokenSet, true, 'token vacío = no tocar');
  assert.equal(s.body.intervalMin, 5, 'mínimo 5 minutos');
  const t = await call('POST', '/api/notify/test', { channel: 'telegram' });
  assert.equal(t.body.result, 'ok');
  assert.equal(up.telegram.at(-1).body.chat_id, '7');
  const e = await call('POST', '/api/notify/test', { channel: 'email' });
  assert.equal(e.status, 400);
  assert.match(e.body.error, /SMTP/);
});

test('los datos se guardan en disco y se puede borrar', async () => {
  await wait(() => fs.existsSync(path.join(tmp, 'db.json')));
  await call('DELETE', `/api/trackers/${id}`);
  await new Promise(r => setTimeout(r, 400));
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'db.json'), 'utf8'));
  assert.equal(saved.trackers.length, 0);
  assert.equal(saved.settings.telegram.token, 'tok');
});

test('el stream envía eventos en tiempo real', async () => {
  const ctrl = new AbortController();
  const r = await fetch(base + '/api/stream', { signal: ctrl.signal });
  const reader = r.body.getReader();
  await call('POST', '/api/engine', { action: 'stop' });
  let txt = '';
  while (!txt.includes('event: engine')) txt += new TextDecoder().decode((await reader.read()).value);
  assert.match(txt, /"running":false/);
  ctrl.abort();
});

test('rechaza peticiones de otras webs (CSRF / DNS rebinding)', async () => {
  const port = new URL(base).port;
  const rebind = await new Promise(resolve => http.get({ host: '127.0.0.1', port, path: '/api/state', headers: { Host: `malo.example:${port}` } }, r => { r.resume(); resolve(r.statusCode); }));
  assert.equal(rebind, 403);
  const csrf = await fetch(base + '/api/notify/test', { method: 'POST', headers: { Origin: 'https://malo.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(csrf.status, 403);
  const own = await fetch(base + '/api/alerts/read', { method: 'POST', headers: { Origin: base } });
  assert.equal(own.status, 200);
});

test('los enlaces de CheapShark no se codifican dos veces', async () => {
  const { body } = await call('POST', '/api/fetch-meta', { q: 'hades' });
  const fan = body.stores.find(s => s.name === 'Fanatical');
  assert.ok(fan);
  const { dealUrl } = await import('../src/sources/cheapshark.js');
  assert.equal(dealUrl('abc%3D'), 'https://www.cheapshark.com/redirect?dealID=abc%3D');
  assert.equal(dealUrl('abc='), 'https://www.cheapshark.com/redirect?dealID=abc%3D');
});
