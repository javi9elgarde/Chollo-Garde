// Vertical de videojuegos con datos reales: CheapShark (tiendas de PC) + Steam España (precio en EUR).
import crypto from 'node:crypto';
import * as cs from './sources/cheapshark.js';
import * as steam from './sources/steam.js';
import { usdToEur } from './sources/fx.js';

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const dayKey = t => new Date(t).toLocaleDateString('sv-SE'); // AAAA-MM-DD en hora local

export class UserError extends Error {}

// Precios actuales de todas las tiendas, en euros.
export async function quote({ gameID, steamAppID }) {
  const [rate, storeMap, g, steamPrice] = await Promise.all([
    usdToEur(),
    gameID ? cs.stores() : null,
    gameID ? cs.game(gameID) : null,
    steamAppID ? steam.priceEs(steamAppID).catch(() => null) : null
  ]);
  const byName = new Map();
  const put = s => { const o = byName.get(s.name); if (!o || s.price < o.price) byName.set(s.name, s); };
  for (const d of g?.deals || []) {
    const st = storeMap.get(String(d.storeID));
    if (!st || !st.active) continue;
    // El precio de Steam en CheapShark es el de EE. UU.; si tenemos el de España, manda ese.
    if (st.name === 'Steam' && steamPrice) continue;
    put({ name: st.name, type: cs.storeType(st.name), price: round(+d.price * rate), usd: +d.price, retailUsd: +d.retailPrice, url: cs.dealUrl(d.dealID), approx: true });
  }
  if (steamPrice) put({ name: 'Steam', type: 'official', price: steamPrice.price, initial: steamPrice.initial, url: steam.appUrl(steamAppID), approx: false });
  const stores = [...byName.values()].sort((a, b) => a.price - b.price);
  const retail = Math.max(0, ...stores.map(s => s.initial || (s.retailUsd ? round(s.retailUsd * rate) : 0)));
  const ever = g?.cheapestPriceEver;
  return {
    title: g?.info?.title || null,
    thumb: g?.info?.thumb || null,
    steamAppID: steamAppID || g?.info?.steamAppID || null,
    stores,
    best: stores[0] || null,
    msrp: steamPrice?.initial || retail || null,
    atlEver: ever && +ever.price > 0 ? { p: round(+ever.price * rate), t: (+ever.date || 0) * 1000, usd: +ever.price, src: 'CheapShark' } : null,
    rate
  };
}

// Auto-fetch del modal «Nuevo tracker»: acepta un enlace de Steam o el nombre del juego.
export async function lookup({ url, q }) {
  let candidates = [], appId = null;
  if (url) {
    appId = steam.appIdFromUrl(url);
    if (!appId) {
      let host = url;
      try { host = new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname; } catch {}
      throw new UserError(`Por ahora los juegos se buscan con un enlace de Steam o por su nombre (fuente: CheapShark). ${host} todavía no tiene conector.`);
    }
    candidates = await cs.byAppId(appId);
  } else if (q && q.trim()) {
    candidates = await cs.search(q.trim(), 8);
  } else throw new UserError('Escribe el nombre del juego o pega su enlace de Steam.');

  const pick = candidates[0];
  if (!pick && !appId) throw new UserError(`CheapShark no encuentra «${q}». Prueba con el nombre en inglés o pega el enlace de Steam.`);
  return describe({ gameID: pick?.gameID || null, steamAppID: appId || pick?.steamAppID || null, url, candidates });
}

// Datos para la vista previa de un juego concreto (también al elegir otro candidato).
export async function describe({ gameID, steamAppID, url, candidates = [] }) {
  const [qt, det] = await Promise.all([
    quote({ gameID, steamAppID }),
    steamAppID ? steam.details(steamAppID).catch(() => null) : null
  ]);
  if (det?.free && !qt.best) throw new UserError(`${det.name} es gratis en Steam: no hace falta vigilar su precio.`);
  if (!qt.best) throw new UserError('No hay ninguna tienda vendiendo este juego ahora mismo, así que no hay precio que vigilar.');
  const appId = qt.steamAppID;
  return {
    cat: 'game', live: true,
    title: det?.name || qt.title || 'Juego',
    image: det?.image || (appId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg` : qt.thumb),
    price: qt.best.price, ship: 0, approx: qt.best.approx,
    store: qt.best.name, src: 'CheapShark + Steam ES', platform: 'PC · Steam',
    url: url || (appId ? steam.appUrl(appId) : qt.best.url),
    gameID, steamAppID: appId,
    stores: qt.stores.map(({ name, price, approx, type }) => ({ name, price, approx, type })),
    msrp: qt.msrp, atlEver: qt.atlEver,
    candidates: candidates.slice(0, 6).map(c => ({ gameID: c.gameID, steamAppID: c.steamAppID || null, title: c.external, thumb: c.thumb }))
  };
}

export async function createTracker({ gameID, steamAppID, target, alert = true, url }) {
  if (!gameID && !steamAppID) throw new UserError('Falta el juego: búscalo primero.');
  if (!(+target > 0)) throw new UserError('Indica un precio objetivo mayor que 0.');
  const [qt, det, rev, dk] = await Promise.all([
    quote({ gameID, steamAppID }),
    steamAppID ? steam.details(steamAppID).catch(() => null) : null,
    steamAppID ? steam.reviews(steamAppID) : null,
    steamAppID ? steam.deck(steamAppID) : null
  ]);
  if (!qt.best) throw new UserError('No hay ninguna tienda vendiendo este juego ahora mismo.');
  const appId = qt.steamAppID, now = Date.now();
  const it = {
    id: 'g-' + crypto.randomBytes(4).toString('hex'),
    cat: 'game', live: true, source: 'CheapShark + Steam ES',
    gameID: gameID || null, steamAppID: appId,
    title: det?.name || qt.title,
    image: det?.image || (appId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg` : qt.thumb),
    url: url || (appId ? steam.appUrl(appId) : qt.best.url), userUrl: !!url, fetchedFrom: url ? 'Steam' : null,
    platform: 'PC · Steam', format: 'Digital', deck: dk,
    msrp: qt.msrp || qt.best.price,
    target: round(+target), alert: !!alert, alerted: false,
    createdAt: now, lastCheck: now, lastError: null,
    stores: qt.stores, current: qt.best.price,
    history: [{ t: now, p: qt.best.price }],
    atlEver: qt.atlEver,
    coupons: [],
    specs: Object.fromEntries([['Género', det?.genres?.join(', ')], ['Metacritic', det?.metacritic], ['Desarrollador', det?.developer], ['Lanzamiento', det?.release]].filter(([, v]) => v)),
    reviews: { rating: rev?.rating ?? null, n: rev?.n ?? 0, src: rev ? `Steam · ${rev.desc}` : 'sin reseñas todavía', pros: [], cons: [] }
  };
  return it;
}

// Un ciclo de rastreo para un tracker: actualiza tiendas, precio actual e histórico diario.
export async function refresh(it) {
  const qt = await quote({ gameID: it.gameID, steamAppID: it.steamAppID });
  if (!qt.best) throw new Error('ninguna tienda lo vende ahora mismo');
  const old = it.current, now = Date.now();
  it.stores = qt.stores;
  it.current = qt.best.price;
  if (qt.msrp) it.msrp = qt.msrp;
  if (qt.atlEver) it.atlEver = qt.atlEver;
  const last = it.history.at(-1);
  if (last && dayKey(last.t) === dayKey(now)) { last.t = now; last.p = it.current; }
  else it.history.push({ t: now, p: it.current });
  if (it.history.length > 365) it.history = it.history.slice(-365);
  it.lastCheck = now; it.lastError = null;
  return { old, current: it.current, best: qt.best };
}
