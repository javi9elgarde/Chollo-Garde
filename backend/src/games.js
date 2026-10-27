// Vertical de videojuegos con precios reales en las tiendas que usa Javi:
// - Instant Gaming y Eneba: búsqueda automática por nombre y plataforma.
// - Amazon, MediaMarkt, Fnac, El Corte Inglés, GAME, Impact o cualquier otra: enlace del producto.
// - Steam España (solo PC): precio oficial de referencia, reseñas y Steam Deck.
import crypto from 'node:crypto';
import * as steam from './sources/steam.js';
import * as keyshops from './sources/keyshops.js';
import * as web from './sources/web.js';
import { shopFor, parseUrl } from './sources/shops.js';

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const dayKey = t => new Date(t).toLocaleDateString('sv-SE'); // AAAA-MM-DD en hora local
export const PLATFORMS = ['PC', 'PS5', 'PS4', 'Switch', 'Xbox'];
const PLATFORM_LABEL = { PC: 'PC', PS5: 'PS5', PS4: 'PS4', Switch: 'Switch', Xbox: 'Xbox' };

export class UserError extends Error {}

// Normaliza lo que llega del panel: título, plataforma, si buscar en tiendas de keys y los enlaces.
function cleanSpec(b = {}) {
  const platform = PLATFORMS.includes(b.platform) ? b.platform : 'PC';
  const links = [...new Set((Array.isArray(b.links) ? b.links : String(b.links || '').split(/\s+/))
    .map(l => parseUrl(l)?.href).filter(Boolean))].slice(0, 12);
  let title = String(b.title ?? b.q ?? '').trim();
  let steamAppID = b.steamAppID ? String(b.steamAppID) : null;
  // Si en el nombre pegan un enlace de Steam, sirve igual.
  const fromUrl = steam.appIdFromUrl(title) || steam.appIdFromUrl(b.url || '');
  if (fromUrl) { steamAppID = fromUrl; if (/^https?:|steampowered/i.test(title)) title = ''; }
  return { title, platform, keys: b.keys !== false, links, steamAppID };
}

async function steamInfo(spec) {
  if (spec.platform !== 'PC') return null;
  let appId = spec.steamAppID;
  if (!appId && spec.title) {
    const hits = await steam.search(spec.title).catch(() => []);
    const best = hits.map(h => ({ h, s: keyshops.score(h.name, spec.title, null) })).filter(x => x.s !== null).sort((a, b) => b.s - a.s)[0];
    appId = best?.h.id || null;
  }
  if (!appId) return null;
  const det = await steam.details(appId).catch(() => null);
  if (!det) return null;
  return { appId, det };
}

// Precios actuales en todas las tiendas configuradas. Las que fallan llevan `error`.
export async function quote(spec, prev = []) {
  const stores = [];
  const st = await steamInfo(spec);
  const title = spec.title || st?.det?.name;
  if (!title) throw new UserError('Escribe el nombre del juego.');
  if (st?.det?.price) stores.push({ name: 'Steam', type: 'official', price: st.det.price.price, initial: st.det.price.initial, url: steam.appUrl(st.appId) });
  if (spec.keys) stores.push(...await keyshops.search(title, spec.platform));
  let image = st?.det?.image || null;
  for (const link of spec.links) {
    const shop = shopFor(link);
    try {
      const p = await web.product(link);
      image = image || p.image;
      stores.push({ name: shop.name, type: shop.type, price: p.price, out: p.out, url: link, match: p.title });
    } catch (e) { stores.push({ name: shop.name, type: shop.type, url: link, error: e.message }); }
  }
  for (const s of stores) {
    image = image || s.image || null;
    delete s.image;
    // Si una tienda falla, se conserva su último precio como referencia, pero no cuenta para alertas.
    if (s.error) {
      const old = prev.find(p => p.name === s.name && (!s.url || p.url === s.url) && p.price);
      if (old) Object.assign(s, { price: old.price, url: s.url || old.url, match: old.match, stale: true });
    }
  }
  const valid = stores.filter(s => s.price && !s.error && !s.out).sort((a, b) => a.price - b.price);
  stores.sort((a, b) => (a.error ? 1 : 0) - (b.error ? 1 : 0) || (a.price || 1e9) - (b.price || 1e9));
  const ref = stores.find(s => s.type === 'official')?.initial || Math.max(0, ...stores.filter(s => s.type !== 'key' && s.price).map(s => s.price)) || null;
  return { title, steam: st, image, stores, best: valid[0] || null, msrp: ref };
}

// Vista previa del modal «Nuevo tracker». Se guarda unos minutos para no repetir la búsqueda al crear.
const previews = new Map();
export async function preview(body) {
  const spec = cleanSpec(body);
  if (!spec.title && !spec.steamAppID) throw new UserError('Escribe el nombre del juego.');
  if (!spec.keys && !spec.links.length && spec.platform !== 'PC') throw new UserError('Activa la búsqueda en Instant Gaming y Eneba o pega al menos un enlace de tienda.');
  const q = await quote(spec);
  if (!q.best) {
    const why = q.stores.map(s => `${s.name}: ${s.error || (s.out ? 'sin stock' : 'sin precio')}`).join(' · ');
    throw new UserError(`No he encontrado ningún precio válido para «${q.title}» en ${PLATFORM_LABEL[spec.platform]}.${why ? ' ' + why : ''}`);
  }
  const id = crypto.randomBytes(6).toString('hex');
  previews.set(id, { spec: { ...spec, title: q.title, steamAppID: q.steam?.appId || null }, q, at: Date.now() });
  for (const [k, v] of previews) if (Date.now() - v.at > 15 * 60e3) previews.delete(k);
  return {
    previewId: id, cat: 'game', live: true,
    title: q.title, platform: spec.platform, image: q.image,
    price: q.best.price, ship: 0, store: q.best.name, src: 'tiendas',
    url: q.best.url, steamAppID: q.steam?.appId || null,
    stores: q.stores.map(({ name, type, price, url, error, out, match, stale }) => ({ name, type, price, url, error, out, match, stale })),
    msrp: q.msrp
  };
}

export async function createTracker(body) {
  if (!(+body.target > 0)) throw new UserError('Indica un precio objetivo mayor que 0.');
  const cached = previews.get(body.previewId);
  const spec = cached?.spec || cleanSpec(body);
  const q = cached?.q || await quote(spec);
  if (!q.best) throw new UserError('No hay ningún precio válido para este juego ahora mismo.');
  const st = q.steam, appId = st?.appId || null;
  const [rev, dk] = appId ? await Promise.all([steam.reviews(appId), steam.deck(appId)]) : [null, null];
  const now = Date.now(), det = st?.det;
  previews.delete(body.previewId);
  return {
    id: 'g-' + crypto.randomBytes(4).toString('hex'),
    cat: 'game', live: true, kind: 'multi', source: 'tiendas',
    title: q.title, query: spec.title || q.title, platform: spec.platform, format: 'Cualquiera',
    keys: spec.keys, links: spec.links, steamAppID: appId,
    image: q.image, url: q.best.url, deck: dk,
    msrp: q.msrp || q.best.price,
    target: round(+body.target), alert: body.alert !== false, alerted: false,
    createdAt: now, lastCheck: now, lastError: null,
    stores: q.stores, current: q.best.price,
    history: [{ t: now, p: q.best.price }],
    coupons: [],
    specs: Object.fromEntries([['Género', det?.genres?.join(', ')], ['Metacritic', det?.metacritic], ['Desarrollador', det?.developer], ['Lanzamiento', det?.release]].filter(([, v]) => v)),
    reviews: { rating: rev?.rating ?? null, n: rev?.n ?? 0, src: rev ? `Steam · ${rev.desc}` : 'sin reseñas todavía', pros: [], cons: [] }
  };
}

// Los trackers creados con la primera versión (CheapShark) pasan a buscar en las tiendas de Javi.
export function migrate(it) {
  if (it.cat !== 'game' || !it.live || it.kind === 'multi') return false;
  Object.assign(it, { kind: 'multi', source: 'tiendas', query: it.title, platform: 'PC', format: 'Cualquiera', keys: true, links: [] });
  delete it.gameID; delete it.atlEver;
  it.stores = (it.stores || []).filter(s => s.name === 'Steam');
  return true;
}

export const specOf = it => ({ title: it.query || it.title, platform: PLATFORMS.includes(it.platform) ? it.platform : 'PC', keys: it.keys !== false, links: it.links || [], steamAppID: it.steamAppID || null });

// Un ciclo de rastreo para un tracker: actualiza tiendas, precio actual e histórico diario.
export async function refresh(it) {
  migrate(it);
  const q = await quote(specOf(it), it.stores || []);
  const old = it.current, now = Date.now();
  it.stores = q.stores;
  if (!q.best) {
    it.lastCheck = now;
    throw new Error(q.stores.map(s => `${s.name}: ${s.error || (s.out ? 'sin stock' : 'sin precio')}`).join(' · ') || 'ninguna tienda devuelve precio');
  }
  it.current = q.best.price;
  it.url = q.best.url;
  if (q.msrp) it.msrp = q.msrp;
  if (!it.image && q.image) it.image = q.image;
  const last = it.history.at(-1);
  if (last && dayKey(last.t) === dayKey(now)) { last.t = now; last.p = it.current; }
  else it.history.push({ t: now, p: it.current });
  if (it.history.length > 365) it.history = it.history.slice(-365);
  // Si al crearlo Steam no devolvió reseñas, se vuelve a intentar.
  if (it.steamAppID && !it.reviews?.n) {
    const rev = await steam.reviews(it.steamAppID);
    if (rev) it.reviews = { ...it.reviews, rating: rev.rating, n: rev.n, src: `Steam · ${rev.desc}` };
  }
  const failed = q.stores.filter(s => s.error).map(s => `${s.name}: ${s.error}`);
  it.lastCheck = now; it.lastError = failed.length ? failed.join(' · ') : null;
  return { old, current: it.current, best: q.best, failed };
}

// Cambiar los enlaces o la búsqueda de keys de un tracker existente.
export function updateSources(it, b) {
  migrate(it);
  if (b.links !== undefined) it.links = cleanSpec({ title: 'x', links: b.links }).links;
  if (b.keys !== undefined) it.keys = !!b.keys;
}
