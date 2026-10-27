// CheapShark (https://apidocs.cheapshark.com): API gratuita y sin clave con ofertas de ~30 tiendas
// oficiales y revendedores autorizados de PC (Steam, GOG, Epic, Humble, Fanatical, GMG…).
// No cubre Eneba, Instant Gaming ni CDKeys. Todos los precios vienen en USD.
import { config } from '../config.js';
import { getJson } from '../http.js';

const OFFICIAL = new Set(['Steam', 'GOG', 'Epic Games Store', 'Origin', 'Uplay', 'Blizzard Shop']);
let storesCache = { map: null, at: 0 };

const api = (p, q = {}) => `${config.cheapsharkBase}${p}?${new URLSearchParams(q)}`;

export async function stores() {
  if (storesCache.map && Date.now() - storesCache.at < 24 * 3600e3) return storesCache.map;
  const list = await getJson(api('/stores'));
  const map = new Map(list.map(s => [String(s.storeID), { name: s.storeName, active: !!s.isActive }]));
  storesCache = { map, at: Date.now() };
  return map;
}

export const storeType = name => (OFFICIAL.has(name) ? 'official' : 'key');
// La API ya devuelve el dealID codificado (termina en %3D): se normaliza para no codificarlo dos veces,
// porque con un dealID mal codificado la redirección acaba en la portada de CheapShark.
export function dealUrl(dealID) {
  let id = String(dealID);
  try { id = decodeURIComponent(id); } catch {}
  return `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(id)}`;
}

export const search = (title, limit = 8) => getJson(api('/games', { title, limit }));
export const byAppId = steamAppID => getJson(api('/games', { steamAppID }));
export const game = id => getJson(api('/games', { id }));

export const _resetStores = () => { storesCache = { map: null, at: 0 }; };
