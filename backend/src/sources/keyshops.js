// Búsqueda automática en las dos tiendas de keys que usa Javi: Instant Gaming y Eneba.
// Busca por nombre, elige la ficha que corresponde al juego y plataforma (descartando DLC,
// bandas sonoras y keys de otras regiones) y lee el precio de la ficha.
import * as web from './web.js';

export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const toks = s => norm(s).split(' ').filter(Boolean);

export const PLATFORMS = {
  PC: ['pc', 'steam'],
  PS5: ['ps5', 'playstation 5', 'playstation5'],
  PS4: ['ps4', 'playstation 4', 'playstation4'],
  'Switch 2': ['switch 2', 'switch2'],
  Switch: ['switch', 'nintendo'],
  Xbox: ['xbox']
};
// Palabras que no cuentan como «otra edición» al comparar títulos.
const NEUTRAL = new Set('pc steam key keys global europe eu es spain cd account cuenta juego juegos videojuego videojuegos game ps5 ps4 psn playstation playstation5 playstation4 5 4 2 xbox series one x s nintendo switch switch2 eshop digital code codigo comprar store windows 10 11 live the edition edicion standard estandar launcher ea app epic games rockstar ubisoft connect battle net gog fisico fisica formato version para de del la el y con en esp espanol castellano pegi nuevo'.split(' '));
const UNWANTED = /\b(dlc|soundtrack|ost|season pass|pase de temporada|expansion|upgrade|mejora|pack|skin|skins|coins|monedas|points|puntos|vbucks|v bucks|credits|bundle|artbook|gift card|tarjeta)\b/;
// En tiendas generalistas, además: segunda mano, accesorios y merchandising.
const UNWANTED_RETAIL = /\b(segunda mano|usado|reacondicionado|funda|mando|amiibo|guia|figura|camiseta|taza|poster|llavero|peluche|lampara|alfombrilla|cargador|auriculares|consola|tarjeta|recarga)\b/;
const OTHER_REGION = /\b(us|usa|united states|north america|latam|latin america|turkey|turquia|argentina|india|brazil|brasil|mena|asia|ru|russia|cis|row|uk|united kingdom|japan|japon|china|korea|mexico|canada)\b/;

// Puntuación de un candidato (mayor es mejor) o null si no vale.
export function score(candidate, title, platform, { retail = false } = {}) {
  const q = toks(title), c = toks(candidate), cs = ' ' + c.join(' ') + ' ';
  if (!q.length || !q.every(t => c.includes(t))) return null;
  const plat = PLATFORMS[platform] || [];
  if (plat.length && !plat.some(k => cs.includes(' ' + k + ' '))) return null;
  // «Switch» no vale para un juego de Switch 2 (y al revés ya lo filtra la lista de arriba).
  const qs = ' ' + q.join(' ') + ' ';
  if (platform === 'Switch' && /\bswitch ?2\b/.test(cs) && !/\bswitch ?2\b/.test(qs)) return null;
  if (UNWANTED.test(cs) && !UNWANTED.test(qs)) return null;
  if (retail && UNWANTED_RETAIL.test(cs) && !UNWANTED_RETAIL.test(qs)) return null;
  if (OTHER_REGION.test(cs.replace(/\b(eu|europe|global)\b/g, ''))) return null;
  const extra = c.filter(t => !q.includes(t) && !NEUTRAL.has(t)).length;
  return 100 - extra * 10 - (/\b(global|europe|eu)\b/.test(cs) ? 0 : 3);
}

export function pick(cands, title, platform, opts) {
  let best = null;
  for (const c of cands) {
    const s = score(c.label, title, platform, opts);
    if (s !== null && (!best || s > best.s)) best = { ...c, s };
  }
  return best;
}

// Busca primero «juego plataforma» (en consolas la primera página suele ser de otras plataformas) y luego solo el juego.
async function searchKeys(search, title, platform) {
  const terms = platform && platform !== 'PC' ? [`${title} ${platform}`, title] : [title];
  let other = false;
  for (const term of terms) {
    const cands = await search(term);
    const best = pick(cands, title, platform);
    if (best) return best;
    other ||= !!pick(cands, title, '');
  }
  throw new Error(other ? `no vende «${title}» para ${platform}, solo para otras plataformas` : `no encuentro «${title}» para ${platform}`);
}

// ---------- Instant Gaming ----------
export function igCandidates(html) {
  const out = [], seen = new Set();
  const re = /href="(https:\/\/www\.instant-gaming\.com\/es\/(\d+)-comprar-([a-z0-9-]+)\/?)"/gi;
  const hits = [...html.matchAll(re)];
  hits.forEach((m, i) => {
    if (seen.has(m[2])) return; seen.add(m[2]);
    const chunk = html.slice(m.index, hits[i + 1]?.index ?? m.index + 3000);
    const title = chunk.match(/title="([^"]+)"/)?.[1] || chunk.match(/class="title"[^>]*>([^<]+)</)?.[1] || '';
    const price = web.parsePrice(chunk.match(/class="price"[^>]*>\s*([^<]+)</)?.[1]);
    out.push({ url: m[1], label: `${title} ${m[3]}`, title: title || m[3].replace(/-/g, ' '), price });
  });
  return out;
}

export async function instantGaming(title, platform) {
  const search = async term => igCandidates((await web.page(`https://www.instant-gaming.com/es/busquedas/?q=${encodeURIComponent(term)}`, { waitFor: '.item' })).html);
  const best = await searchKeys(search, title, platform);
  let price = best.price, out = false, img = null;
  if (!price) ({ price, out, image: img } = await web.product(best.url));
  return { name: 'Instant Gaming', type: 'key', url: best.url, price, out, match: best.title, image: img };
}

// ---------- Eneba ----------
export function enebaCandidates(html) {
  const out = [], seen = new Set();
  for (const m of html.matchAll(/href="(?:https:\/\/www\.eneba\.com)?\/es\/([a-z0-9][a-z0-9-]{6,})"/gi)) {
    const slug = m[1];
    if (seen.has(slug) || /^(store|collection|blog|support|promo|top-up|gift-cards?|giftcards?)\b/.test(slug)) continue;
    seen.add(slug);
    out.push({ url: `https://www.eneba.com/es/${slug}`, label: slug, title: slug.replace(/-/g, ' ') });
  }
  return out;
}

export async function eneba(title, platform) {
  const search = async term => enebaCandidates((await web.page(`https://www.eneba.com/es/store/all?text=${encodeURIComponent(term)}`, { forceBrowser: true, waitFor: 'a[href*="/es/"]' })).html);
  const best = await searchKeys(search, title, platform);
  const prod = await web.product(best.url);
  return { name: 'Eneba', type: 'key', url: best.url, price: prod.price, out: prod.out, match: prod.title || best.title, image: prod.image };
}

export const KEY_SHOPS = { 'Instant Gaming': instantGaming, Eneba: eneba };
