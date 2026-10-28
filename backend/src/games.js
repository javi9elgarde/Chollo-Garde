// Vertical de videojuegos con precios reales en las tiendas que usa Javi:
// - Búsqueda automática por nombre y plataforma en Instant Gaming, Eneba (keys) y Amazon, MediaMarkt, Fnac,
//   El Corte Inglés, GAME e Impact. La ficha encontrada se recuerda y en cada ciclo solo se relee su precio.
// - Enlaces opcionales: para otra tienda o para corregir la versión que haya elegido una búsqueda.
// - Steam España (solo PC): precio oficial de referencia, reseñas y Steam Deck.
// - PlayStation Store (PS5 y PS4): precio oficial de referencia y precio de lanzamiento.
import crypto from 'node:crypto';
import * as steam from './sources/steam.js';
import * as keyshops from './sources/keyshops.js';
import * as web from './sources/web.js';
import * as retail from './sources/retail.js';
import * as chollometro from './sources/chollometro.js';
import * as psstore from './sources/psstore.js';
import * as rawg from './sources/rawg.js';
import * as igdb from './sources/igdb.js';
import * as pc from './pcdata.js';
import { shopFor, parseUrl } from './sources/shops.js';
import { log } from './bus.js';

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const dayKey = t => new Date(t).toLocaleDateString('sv-SE'); // AAAA-MM-DD en hora local
export const PLATFORMS = ['PC', 'PS5', 'PS4', 'Switch 2', 'Switch', 'Xbox'];
export const KEY_NAMES = Object.keys(keyshops.KEY_SHOPS);
export const SHOP_NAMES = [...KEY_NAMES, ...retail.RETAIL_NAMES];

export class UserError extends Error {}

// Normaliza lo que llega del panel: título, plataforma, tiendas donde buscar y enlaces.
function cleanSpec(b = {}) {
  const platform = PLATFORMS.includes(b.platform) ? b.platform : 'PC';
  const links = [...new Set((Array.isArray(b.links) ? b.links : String(b.links || '').split(/\s+/))
    .map(l => parseUrl(l)?.href).filter(Boolean))].slice(0, 12);
  let title = String(b.title ?? b.q ?? '').trim();
  let steamAppID = b.steamAppID ? String(b.steamAppID) : null;
  // Si en el nombre pegan un enlace de Steam, sirve igual.
  const fromUrl = steam.appIdFromUrl(title) || steam.appIdFromUrl(b.url || '');
  if (fromUrl) { steamAppID = fromUrl; if (/^https?:|steampowered/i.test(title)) title = ''; }
  // `shops`: tiendas donde buscar solo. Los trackers de antes solo tenían `keys` (sí/no).
  const shops = Array.isArray(b.shops) ? SHOP_NAMES.filter(n => b.shops.includes(n)) : b.keys === false ? [...retail.RETAIL_NAMES] : [...SHOP_NAMES];
  return { title, platform, shops, links, steamAppID };
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

// La ficha de un ciclo anterior se reutiliza mientras su nombre siga valiendo con las reglas actuales
// (así se corrige sola una ficha mal elegida por una versión anterior, como un pack con otro juego).
// La plataforma ya se comprobó al buscarla: muchas fichas no la llevan en el nombre.
const fits = (p, title) => !p.match || p.type === 'deal' || keyshops.score(p.match, title, null, { retail: p.type !== 'key', loose: true }) !== null;

// Una tienda con búsqueda automática: si ya se encontró la ficha, solo se relee su precio;
// si esa ficha ya no vale (retirada, sin precio…), se vuelve a buscar.
async function findIn(name, title, platform, prev, reject = []) {
  const type = KEY_NAMES.includes(name) ? 'key' : 'retail';
  const known = prev.find(p => p.name === name && p.auto && p.url && !reject.includes(p.url) && fits(p, title));
  if (known) {
    try {
      const p = await web.product(known.url);
      // Si la elección era dudosa, sigue pendiente de que Javi diga cuál es.
      return { name, type, auto: true, url: known.url, price: p.price, out: p.out, pre: p.pre, match: p.title || known.match, image: p.image, ...(known.doubt && { doubt: true, options: known.options }) };
    } catch {}
  }
  try {
    const r = await (type === 'key' ? keyshops.KEY_SHOPS[name] : (t, pl, o) => retail.find(name, t, pl, o))(title, platform, { reject });
    return { ...r, auto: true };
  } catch (e) { return { name, type, auto: true, error: e.message }; }
}

// Precios actuales en todas las tiendas configuradas. Las que fallan llevan `error`.
// En modo mixto (ver pcdata.js) el PC solo mira sus tiendas y GitHub reutiliza lo que el PC ha leído.
export async function quote(spec, prev = [], { trackerId = null } = {}) {
  const mode = pc.mode(), forPc = name => pc.PC_SHOPS.includes(name);
  const stores = [];
  const st = mode === 'pc' ? null : await steamInfo(spec);
  const title = spec.title || st?.det?.name;
  if (!title) throw new UserError('Escribe el nombre del juego.');
  if (st?.det?.price) stores.push({ name: 'Steam', type: 'official', price: st.det.price.price, initial: st.det.price.initial, url: steam.appUrl(st.appId) });
  // En PlayStation la tienda oficial es la PS Store. Si falla, se queda su último precio como referencia.
  const official = mode === 'pc' || !psstore.covers(spec.platform) ? null : psstore.find(title, spec.platform).catch(e => ({ name: 'PS Store', type: 'official', error: e.message }));
  let image = st?.det?.image || null;
  // Un enlace pegado manda sobre la búsqueda automática en esa tienda.
  const linked = new Set(spec.links.map(l => shopFor(l).name));
  let auto = spec.shops.filter(n => !linked.has(n)), links = spec.links;
  if (mode === 'pc') { auto = auto.filter(forPc); links = links.filter(l => forPc(shopFor(l).name)); }
  if (mode === 'nube' && trackerId) {
    // Lo que el PC ha leído hace poco no se vuelve a pedir desde GitHub (allí salen captchas).
    const fromPc = (pc.fresh(trackerId) || []).filter(s => !s.error && s.price);
    auto = auto.filter(n => !fromPc.some(s => s.auto && s.name === n));
    links = links.filter(l => !fromPc.some(s => !s.auto && s.url === l));
    stores.push(...fromPc.map(s => ({ ...s, via: 'pc' })));
  }
  // Chollometro: ofertas compartidas por la gente, si el tracker busca solo en tiendas. Si no hay ninguna activa, no aparece.
  const deal = mode === 'pc' || !spec.shops.length ? null : chollometro.find(title, spec.platform).catch(e => (/ninguna oferta|no ha devuelto/.test(e.message) ? null : { name: 'Chollometro', type: 'deal', error: e.message }));
  const fromLinks = links.map(async link => {
    const shop = shopFor(link);
    try {
      const p = await web.product(link);
      return { name: shop.name, type: shop.type, price: p.price, out: p.out, pre: p.pre, url: link, match: p.title, image: p.image };
    } catch (e) { return { name: shop.name, type: shop.type, url: link, error: e.message }; }
  });
  stores.push(...await Promise.all([...auto.map(n => findIn(n, title, spec.platform, prev, spec.reject?.[n] || [])), ...fromLinks]));
  const d = await deal;
  if (d) stores.push(d);
  const off = await official;
  if (off) stores.push(off);
  for (const s of stores) {
    image = image || s.image || null;
    delete s.image;
    // Si una tienda falla, se conserva su último precio como referencia, pero no cuenta para alertas.
    if (s.error) {
      const old = prev.find(p => p.name === s.name && (!s.url || p.url === s.url) && p.price && (!p.auto || fits(p, title)));
      if (old) Object.assign(s, { price: old.price, url: s.url || old.url, match: old.match, stale: true, ...(old.initial && { initial: old.initial }) });
    }
  }
  // Una línea por tienda en el registro: así se ve qué ha encontrado cada una o por qué ha fallado.
  for (const s of stores) log(s.error ? 'warn' : 'info', s.name, s.error ? `${title} (${spec.platform}): ${s.error}` : `${title} (${spec.platform}): ${s.out ? 'sin stock' : s.price + ' €'} · ${s.match || s.url || ''}${s.via === 'pc' ? ' · leído desde tu PC' : ''}${s.doubt ? ` · dudoso, ${s.options.length} opciones para elegir` : ''}`);
  // Una ficha dudosa no cuenta para el precio actual ni para las alertas hasta que Javi confirme cuál es.
  const valid = stores.filter(s => s.price && !s.error && !s.out && !s.doubt).sort((a, b) => a.price - b.price);
  stores.sort((a, b) => (a.error ? 1 : 0) - (b.error ? 1 : 0) || (a.price || 1e9) - (b.price || 1e9));
  const ref = stores.find(s => s.type === 'official')?.initial || Math.max(0, ...stores.filter(s => s.type !== 'key' && s.type !== 'deal' && s.price).map(s => s.price)) || null;
  return { title, steam: st, image, stores, best: valid[0] || null, msrp: ref };
}

// Vista previa del modal «Nuevo tracker». Se guarda unos minutos para no repetir la búsqueda al crear.
const previews = new Map();
export async function preview(body) {
  const spec = cleanSpec(body);
  if (!spec.title && !spec.steamAppID) throw new UserError('Escribe el nombre del juego.');
  if (!spec.shops.length && !spec.links.length && spec.platform !== 'PC') throw new UserError('Marca al menos una tienda o pega un enlace.');
  const q = await quote(spec);
  if (!q.best) {
    const why = q.stores.map(s => `${s.name}: ${s.error || (s.out ? 'sin stock' : 'sin precio')}`).join(' · ');
    throw new UserError(`No he encontrado ningún precio válido para «${q.title}» en ${spec.platform}.${why ? ' ' + why : ''}`);
  }
  const id = crypto.randomBytes(6).toString('hex');
  previews.set(id, { spec: { ...spec, title: q.title, steamAppID: q.steam?.appId || null }, q, at: Date.now() });
  for (const [k, v] of previews) if (Date.now() - v.at > 15 * 60e3) previews.delete(k);
  return {
    previewId: id, cat: 'game', live: true,
    title: q.title, platform: spec.platform, image: q.image,
    price: q.best.price, ship: 0, store: q.best.name, src: 'tiendas',
    url: q.best.url, steamAppID: q.steam?.appId || null,
    stores: q.stores.map(({ name, type, price, url, error, out, pre, match, stale, auto, doubt, options }) => ({ name, type, price, url, error, out, pre, match, stale, auto, doubt, options })),
    msrp: q.msrp
  };
}

export async function createTracker(body) {
  if (!(+body.target > 0)) throw new UserError('Indica un precio objetivo mayor que 0.');
  const cached = previews.get(body.previewId);
  const spec = cached?.spec || cleanSpec(body);
  const q = cached?.q || await quote(spec);
  if (!q.best) throw new UserError(`No he encontrado ningún precio válido para «${q.title}» en ${spec.platform}. ${q.stores.map(s => `${s.name}: ${s.error || (s.out ? 'sin stock' : 'sin precio')}`).join(' · ')}`);
  const st = q.steam, appId = st?.appId || null;
  const [rev, dk] = appId ? await Promise.all([steam.reviews(appId), steam.deck(appId)]) : [null, null];
  const now = Date.now(), det = st?.det;
  previews.delete(body.previewId);
  return {
    id: 'g-' + crypto.randomBytes(4).toString('hex'),
    cat: 'game', live: true, kind: 'multi', source: 'tiendas',
    title: q.title, query: spec.title || q.title, platform: spec.platform, format: 'Cualquiera',
    shops: spec.shops, links: spec.links, steamAppID: appId,
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

// Trackers de versiones anteriores: los de CheapShark pasan a las tiendas de Javi y los que solo
// tenían «keys sí/no» pasan a la lista de tiendas con búsqueda automática.
export function migrate(it) {
  if (it.cat !== 'game' || !it.live) return false;
  let changed = false;
  if (it.kind !== 'multi') {
    Object.assign(it, { kind: 'multi', source: 'tiendas', query: it.title, platform: 'PC', format: 'Cualquiera', keys: true, links: [] });
    delete it.gameID; delete it.atlEver;
    it.stores = (it.stores || []).filter(s => s.name === 'Steam');
    changed = true;
  }
  if (!Array.isArray(it.shops)) {
    it.shops = it.keys === false ? [...retail.RETAIL_NAMES] : [...SHOP_NAMES];
    // Las fichas de Instant Gaming y Eneba encontradas antes se siguen usando.
    (it.stores || []).forEach(s => { if (KEY_NAMES.includes(s.name) && s.url && !(it.links || []).includes(s.url)) s.auto = true; });
    delete it.keys;
    changed = true;
  }
  return changed;
}

export const specOf = it => ({ title: it.query || it.title, platform: PLATFORMS.includes(it.platform) ? it.platform : 'PC', shops: it.shops || [...SHOP_NAMES], links: it.links || [], reject: it.reject || {}, steamAppID: it.steamAppID || null });

// Arte apaisado y datos del juego: primero IGDB (como el Refugio 111), si no lo encuentra RAWG.
// Si ninguno lo encuentra, se vuelve a probar al día siguiente.
export async function addArt(it) {
  if (it.art || (it.artTried && Date.now() - it.artTried < 864e5)) return;
  const srcs = [['IGDB', igdb], ['RAWG', rawg]].filter(([, s]) => s.enabled());
  if (!srcs.length) return;
  it.artTried = Date.now();
  for (const [name, src] of srcs) {
    try {
      const r = await src.info(it.query || it.title);
      if (!r) continue;
      it.art = r.art;
      if (r.igdb) it.igdb = r.igdb;
      if (r.rawg) it.rawg = r.rawg;
      it.specs = { ...(r.genres && { Género: r.genres }), ...(r.developer && { Desarrolladora: r.developer }), ...(r.released && { Lanzamiento: r.released }), ...(r.metacritic && { Metacritic: r.metacritic }), ...it.specs };
      return;
    } catch (e) { log('warn', name, `${it.title}: ${e.message}`); }
  }
}

// Un ciclo de rastreo para un tracker: actualiza tiendas, precio actual e histórico diario.
export async function refresh(it) {
  await addArt(it);
  migrate(it);
  const q = await quote(specOf(it), it.stores || [], { trackerId: it.id });
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

// Cambiar las tiendas o los enlaces de un tracker existente.
export function updateSources(it, b) {
  migrate(it);
  if (b.links !== undefined) it.links = cleanSpec({ title: 'x', links: b.links }).links;
  if (Array.isArray(b.shops)) it.shops = cleanSpec({ title: 'x', shops: b.shops }).shops;
  // «Ninguno es»: esas fichas no se vuelven a proponer en esa tienda y se busca otra.
  if (b.reject && typeof b.reject === 'object') {
    it.reject ||= {};
    for (const [shop, urls] of Object.entries(b.reject)) {
      if (!SHOP_NAMES.includes(shop) || !Array.isArray(urls)) continue;
      it.reject[shop] = [...new Set([...(it.reject[shop] || []), ...urls.map(u => parseUrl(u)?.href).filter(Boolean)])].slice(-30);
    }
  }
  // Si cambian las tiendas o los enlaces, se olvidan las fichas que ya no se usan.
  const linked = new Set(it.links.map(l => shopFor(l).name));
  const rejected = s => (it.reject?.[s.name] || []).includes(s.url);
  it.stores = (it.stores || []).filter(s => s.type === 'official' || s.type === 'deal' || (s.auto ? it.shops.includes(s.name) && !linked.has(s.name) && !rejected(s) : it.links.includes(s.url)));
}

// Runner del PC: precios de Amazon, Fnac y El Corte Inglés para un tracker (los guarda pcdata.js).
export async function pcQuote(it) {
  migrate(it);
  return (await quote(specOf(it), it.stores || [])).stores;
}
