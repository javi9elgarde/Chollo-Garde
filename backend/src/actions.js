// Operaciones sobre los trackers, compartidas por el servidor (panel en tu PC) y por la versión de GitHub.
import * as store from './store.js';
import * as games from './games.js';
import { norm } from './sources/keyshops.js';
import { bus, log } from './bus.js';
import { dispatch } from './notify/index.js';
import { hostStats } from './http.js';
import { config } from './config.js';
import { parseUrl, shopFor } from './sources/shops.js';

const db = () => store.get();
export const find = id => db().trackers.find(t => t.id === id);

export class NotFound extends games.UserError {}

// Crea el tracker. Devuelve el tracker y `notify`, que manda la alerta si ya está por debajo del objetivo.
export async function addTracker(b = {}) {
  if (b.cat && b.cat !== 'game') throw new games.UserError('De momento solo hay fuente real para videojuegos. Productos y vuelos llegarán en las próximas fases.');
  const it = await games.createTracker(b);
  const key = t => `${norm(t.title)}|${t.platform || 'PC'}`;
  const dup = db().trackers.find(t => t.cat === 'game' && t.live && key(t) === key(it));
  if (dup) throw new games.UserError(`Ya sigues «${dup.title}». Cambia su objetivo desde su ficha.`);
  await games.addArt(it);
  db().trackers.unshift(it);
  store.save();
  log('ok', 'api', `tracker creado: «${it.title}» · objetivo ${it.target} €`);
  bus.emit('event', 'tracker', it);
  const notify = async () => { if (it.alert && it.current <= it.target) { it.alerted = true; store.save(); await dispatch(it); } };
  return { it, notify };
}

// Cambia objetivo, alerta, tiendas o enlaces. `rescan`: hay que volver a mirar los precios; `notify` como arriba.
export function editTracker(id, b = {}) {
  const it = find(id);
  if (!it) throw new NotFound('Ese tracker no existe');
  let fire = false;
  if (b.target !== undefined) {
    if (!(+b.target > 0)) throw new games.UserError('El objetivo tiene que ser mayor que 0.');
    it.target = Math.round(+b.target * 100) / 100;
    it.alerted = false;
    fire = true;
  }
  if (b.alert !== undefined) { it.alert = !!b.alert; if (it.alert) { it.alerted = false; fire = true; } }
  const rescan = it.cat === 'game' && it.live && (b.links !== undefined || b.shops !== undefined || b.reject !== undefined);
  if (rescan) { games.updateSources(it, b); log('info', 'api', `«${it.title}»: tiendas actualizadas, comprobando precios`); }
  store.save();
  bus.emit('event', 'tracker', it);
  const notify = async () => { if (!rescan && fire && it.alert && it.current <= it.target) { it.alerted = true; store.save(); await dispatch(it); } };
  return { it, rescan, notify };
}

export function removeTracker(id) {
  const it = find(id);
  if (!it) throw new NotFound('Ese tracker no existe');
  db().trackers = db().trackers.filter(t => t.id !== it.id);
  store.save();
  log('warn', 'api', `tracker eliminado: «${it.title}»`);
  bus.emit('event', 'tracker-removed', { id: it.id });
  return it;
}

// Tabla «Fuentes» del panel: tiendas con su tasa de éxito y latencia.
export function sourceRows() {
  const stats = new Map(hostStats().map(s => [s.host, s]));
  const row = (name, kind, covers, host) => {
    const s = stats.get(host) || {};
    return { name, kind, covers, host, ok: s.runs ? Math.round((1 - s.fails / s.runs) * 100) : null, lat: s.lat || null, last: s.last || null, status: s.runs ? s.status : 'idle', runs: s.runs || 0 };
  };
  const base = [
    row('Instant Gaming', 'búsqueda', 'Keys · búsqueda automática', 'www.instant-gaming.com'),
    row('Eneba', 'navegador', 'Keys · búsqueda automática', 'www.eneba.com'),
    row('Amazon', 'navegador', 'Búsqueda automática', 'www.amazon.es'),
    row('MediaMarkt', 'navegador', 'Búsqueda automática', 'www.mediamarkt.es'),
    row('Fnac', 'navegador', 'Búsqueda automática', 'www.fnac.es'),
    row('El Corte Inglés', 'navegador', 'Búsqueda automática', 'www.elcorteingles.es'),
    row('GAME', 'búsqueda', 'Búsqueda automática', 'www.game.es'),
    row('Impact', 'búsqueda', 'Búsqueda automática', 'impactgame.es'),
    row('Chollometro', 'búsqueda', 'Ofertas de la comunidad', 'www.chollometro.com'),
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
}
