// Prueba de extremo a extremo con tiendas y APIs simuladas (Instant Gaming, Eneba, Amazon, MediaMarkt, Fnac,
// El Corte Inglés, GAME, Impact, Steam, Telegram y Discord).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { up, pages, handler, serve } from './fixtures.mjs';

const upstream = http.createServer(handler);

let base, server, tmp;
before(async () => {
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const ub = `http://127.0.0.1:${upstream.address().port}`;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  Object.assign(process.env, {
    DATA_DIR: tmp, STEAM_STORE_BASE: ub + '/steam', TELEGRAM_API_BASE: ub + '/tg',
    TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42', DISCORD_WEBHOOK_URL: ub + '/discord', SMTP_USER: '', SMTP_PASS: ''
  });
  const web = await import('../src/sources/web.js');
  web._setFetchers({ fetch: serve, render: serve });
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

const FNAC = 'https://www.fnac.es/a123/Hades-II';

test('estado inicial y ajustes sin secretos', async () => {
  const { body } = await call('GET', '/api/state');
  assert.deepEqual(body.trackers, []);
  assert.equal(body.settings.telegram.tokenSet, true);
  assert.equal(body.settings.telegram.token, undefined);
  assert.equal(body.settings.discord.url, undefined);
});

let previewId;
test('vista previa: busca sola en todas las tiendas, elige la versión correcta y la tienda más barata', async () => {
  const { status, body } = await call('POST', '/api/fetch-meta', { title: 'Hades II', platform: 'PC', links: FNAC });
  assert.equal(status, 200, JSON.stringify(body));
  previewId = body.previewId;
  assert.equal(body.title, 'Hades II');
  assert.equal(body.steamAppID, '1145350', 'elige «Hades II» y no «Hades»');
  assert.equal(body.store, 'Eneba');
  assert.equal(body.price, 18.2);
  assert.equal(body.msrp, 29.5);
  const by = Object.fromEntries(body.stores.map(s => [s.name, s]));
  assert.equal(by['Instant Gaming'].price, 19.49, 'descarta la banda sonora');
  assert.match(by['Instant Gaming'].url, /1234-comprar-hades-ii-pc/);
  assert.match(by.Eneba.url, /key-global$/, 'descarta la key de EE. UU.');
  assert.equal(by.Amazon.url, 'https://www.amazon.es/dp/B0PCAAAAAA', 'ni la funda ni la de PS5');
  assert.equal(by.Amazon.price, 24.95);
  assert.equal(by.MediaMarkt.price, 26.99);
  assert.equal(by.GAME.url, 'https://www.game.es/hades-ii-pc/231234', 'ni segunda mano ni PS5');
  assert.equal(by.GAME.price, 29.95);
  assert.equal(by.Impact.out, true, 'agotado: no cuenta como mejor precio');
  assert.match(by['El Corte Inglés'].error, /no ha devuelto productos/);
  assert.match(by.Fnac.error, /captcha/);
  assert.equal(by.Fnac.auto, undefined, 'el enlace pegado manda sobre la búsqueda');
  assert.ok(!up.hits.some(u => u.includes('fnac.es/SearchResult')));
  assert.equal(by.Steam.type, 'official');
  assert.ok(['Fnac', 'El Corte Inglés'].includes(body.stores.at(-1).name), 'las tiendas con error van al final');
});

test('vista previa: errores claros', async () => {
  const none = await call('POST', '/api/fetch-meta', { title: '', keys: true });
  assert.equal(none.status, 400);
  const ps5 = await call('POST', '/api/fetch-meta', { title: 'Hades II', platform: 'PS5', shops: [] });
  assert.equal(ps5.status, 400);
  assert.match(ps5.body.error, /tienda/);
  const nothing = await call('POST', '/api/fetch-meta', { title: 'Juego inventado', platform: 'Switch', shops: ['Instant Gaming'] });
  assert.equal(nothing.status, 400);
  assert.match(nothing.body.error, /Instant Gaming: no encuentro/);
});

let id;
test('crear tracker, detectar duplicado y rechazar categorías sin fuente', async () => {
  const r = await call('POST', '/api/trackers', { previewId, target: 15 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  id = r.body.id;
  assert.equal(r.body.current, 18.2);
  assert.equal(r.body.platform, 'PC');
  assert.deepEqual(r.body.links, [FNAC]);
  assert.equal(r.body.shops.length, 8);
  assert.equal(r.body.deck, 'Verificado');
  assert.equal(r.body.reviews.rating, 4.8);
  assert.equal(r.body.history.length, 1);
  assert.equal((await call('POST', '/api/trackers', { title: 'hades ii', platform: 'PC', shops: ['Eneba'], target: 10 })).status, 400);
  assert.equal((await call('POST', '/api/trackers', { cat: 'product', target: 10 })).status, 400);
  const src = (await call('GET', '/api/sources')).body.map(s => s.name);
  assert.ok(src.includes('Amazon') && src.includes('Impact') && src.includes('Instant Gaming'));
});

test('el motor actualiza el precio y dispara Telegram y Discord al llegar al objetivo', async () => {
  up.eneba = 14.0;
  up.hits = [];
  const r = await call('POST', `/api/trackers/${id}/scan`);
  assert.equal(r.status, 200);
  await wait(async () => (await call('GET', '/api/state')).body.alerts.length === 1);
  const { body } = await call('GET', '/api/state');
  const it = body.trackers[0];
  assert.equal(it.current, 14);
  assert.equal(it.alerted, true);
  assert.equal(it.history.length, 1, 'mismo día: se actualiza el punto, no se duplica');
  assert.match(it.lastError, /Fnac/);
  // Las fichas ya encontradas no se vuelven a buscar: solo se relee su precio.
  for (const search of ['instant-gaming.com/es/busquedas', 'eneba.com/es/store', 'amazon.es/s?', 'mediamarkt.es/es/search', 'game.es/resultados', 'impactgame.es/?s=']) assert.ok(!up.hits.some(u => u.includes(search)), search);
  assert.ok(up.hits.some(u => u.includes('elcorteingles.es/search')), 'la que no encontró nada se vuelve a buscar');
  assert.deepEqual(body.alerts[0].channels, { web: true, telegram: 'ok', discord: 'ok', email: 'off' });
  assert.equal(up.telegram.at(-1).method, 'sendPhoto');
  assert.match(up.telegram.at(-1).body.caption, /Hades II[\s\S]*Eneba/);
  assert.equal(up.discord.at(-1).embeds[0].title, 'Hades II');
  // Sin bajar más, no se repite la alerta.
  await call('POST', `/api/trackers/${id}/scan`);
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await call('GET', '/api/state')).body.alerts.length, 1);
});

test('si una tienda falla se conserva su último precio, marcado como antiguo', async () => {
  up.igDown = true;
  await call('POST', `/api/trackers/${id}/scan`);
  await wait(async () => (await call('GET', '/api/state')).body.trackers[0].stores.find(s => s.name === 'Instant Gaming')?.stale);
  const ig = (await call('GET', '/api/state')).body.trackers[0].stores.find(s => s.name === 'Instant Gaming');
  assert.equal(ig.price, 19.49);
  assert.ok(ig.error);
  up.igDown = false;
});

test('cambiar enlaces y objetivo desde la ficha', async () => {
  const amazon = 'https://www.amazon.es/dp/B0TEST1234';
  const l = await call('PATCH', `/api/trackers/${id}`, { links: [amazon], shops: [] });
  assert.deepEqual(l.body.links, [amazon]);
  assert.deepEqual(l.body.shops, []);
  await wait(async () => { const t = (await call('GET', '/api/state')).body.trackers[0]; return t.stores.length === 2 && t.stores.some(s => s.url === amazon); });
  const t = (await call('GET', '/api/state')).body.trackers[0];
  assert.deepEqual(t.stores.map(s => s.name).sort(), ['Amazon', 'Steam']);
  assert.equal(t.current, 24.95);
  const p = await call('PATCH', `/api/trackers/${id}`, { target: 12, alert: true });
  assert.equal(p.body.target, 12);
  assert.equal(p.body.alerted, false);
});

test('ajustes y prueba de canal', async () => {
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
