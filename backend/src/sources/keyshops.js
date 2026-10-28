// Búsqueda automática en las dos tiendas de keys que usa Javi: Instant Gaming y Eneba.
// Busca por nombre, elige la ficha que corresponde al juego y plataforma (descartando DLC,
// bandas sonoras y keys de otras regiones) y lee el precio de la ficha.
import * as web from './web.js';

// «Marvel's» y «Marvel’s» se escriben juntos («marvels»): así coinciden con «Marvels» y, quitando la s, con «Marvel».
export const norm = s => String(s || '').replace(/['’`´]s\b/gi, 's').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Formas distintas de escribir lo mismo: «Vol.», «Volume» y «Volumen»; «Hades II» y «Hades 2».
const SYN = { volume: 'vol', volumen: 'vol', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', and: 'y', edition: 'edicion' };
const toks = s => norm(s).split(' ').filter(Boolean).map(t => SYN[t] || t);

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
// Títulos que en España se venden con otro nombre (GAME e Impact llaman «Lobezno» a Wolverine).
const ALIAS = { wolverine: ['lobezno'] };
// Ediciones caras: solo valen si se piden en el nombre (si no, se busca la estándar).
const PREMIUM = /\b(ultimate|deluxe|gold|premium|collector|collectors|coleccionista|legendary|champions|vault)\b/;
const UNWANTED = /\b(dlc|soundtrack|ost|season pass|pase de temporada|expansion|upgrade|mejora|pack|skin|skins|coins|monedas|points|puntos|vbucks|v bucks|credits|bundle|artbook|gift card|tarjeta)\b/;
// En tiendas generalistas, además: segunda mano, accesorios y merchandising.
const UNWANTED_RETAIL = /\b(segunda mano|usado|reacondicionado|funda|mando|amiibo|guia|figura|camiseta|taza|poster|llavero|peluche|lampara|alfombrilla|cargador|auriculares|consola|tarjeta|recarga)\b/;
const OTHER_REGION = /\b(us|usa|united states|north america|latam|latin america|turkey|turquia|argentina|india|brazil|brasil|mena|asia|ru|russia|cis|row|uk|united kingdom|japan|japon|china|korea|mexico|canada)\b/;

// Puntuación de un candidato (mayor es mejor) o null si no vale.
// `loose`: búsqueda por palabras clave. Vale aunque falte alguna palabra del nombre (una de cada cuatro),
// pero nunca un número («Vol. 2» no es «Vol. 1»). Esos resultados se marcan como dudosos para que Javi elija.
export function score(candidate, title, platform, { retail = false, loose = false } = {}) {
  const q = toks(title), c = toks(candidate), cs = ' ' + c.join(' ') + ' ';
  // «FC 27» y «FC27» son lo mismo: vale la palabra suelta, pegada a la vecina o separada en letras y número.
  const glued = new Set([...q.slice(1).map((t, i) => q[i] + t), ...q.flatMap(t => t.match(/^([a-z]+)(\d+)$/)?.slice(1) || [])]);
  const has = (t, i) => c.includes(t) || (ALIAS[t] || []).some(a => c.includes(a)) || (t.length > 3 && (c.includes(t + 's') || (t.endsWith('s') && c.includes(t.slice(0, -1))))) || c.includes(t + q[i + 1]) || c.includes(q[i - 1] + t) || (/^([a-z]+)(\d+)$/.test(t) && cs.includes(' ' + t.replace(/^([a-z]+)(\d+)$/, '$1 $2') + ' '));
  const missing = q.filter((t, i) => !has(t, i));
  const sig = q.filter(t => !NEUTRAL.has(t)).length;
  if (!q.length) return null;
  if (missing.length && (!loose || missing.some(t => /\d/.test(t)) || missing.filter(t => !NEUTRAL.has(t)).length > Math.floor(sig / 4))) return null;
  // Otro número junto a la misma palabra («Vol. 1» al buscar «Vol. 2», «FC 26» al buscar «FC 27»): es otro
  // juego o un pack con otro juego, aunque también lleve el que se busca.
  // Solo números cortos: los códigos de producto de las direcciones («ppsa01234», «1621005») no cuentan.
  const numPairs = list => list.flatMap((t, i) => (/^[a-z]+$/.test(t) && /^\d{1,3}$/.test(list[i + 1] || '') ? [[t, list[i + 1]]] : /^([a-z]+)(\d{1,3})$/.test(t) ? [t.match(/^([a-z]+)(\d+)$/).slice(1)] : []));
  const nums = new Map(numPairs(q)), pairs = numPairs(c);
  if (pairs.some(([w, n]) => nums.has(w) && nums.get(w) !== n)) return null;
  const plat = PLATFORMS[platform] || [];
  if (plat.length && !plat.some(k => cs.includes(' ' + k + ' '))) return null;
  // «Switch» no vale para un juego de Switch 2 (y al revés ya lo filtra la lista de arriba).
  const qs = ' ' + q.join(' ') + ' ';
  if (platform === 'Switch' && /\bswitch ?2\b/.test(cs) && !/\bswitch ?2\b/.test(qs)) return null;
  if (UNWANTED.test(cs) && !UNWANTED.test(qs)) return null;
  if (PREMIUM.test(cs) && !PREMIUM.test(qs)) return null;
  if (retail && UNWANTED_RETAIL.test(cs) && !UNWANTED_RETAIL.test(qs)) return null;
  if (OTHER_REGION.test(cs.replace(/\b(eu|europe|global)\b/g, ''))) return null;
  const extra = c.filter(t => !q.includes(t) && !glued.has(t) && !NEUTRAL.has(t)).length;
  return 100 - extra * 10 - missing.length * 30 - (/\b(global|europe|eu)\b/.test(cs) ? 0 : 3);
}

// La mejor ficha de una lista de resultados, o null. Si hay otras casi igual de buenas, o solo se ha
// encontrado por palabras clave, lleva `doubt` y las opciones para que Javi elija cuál es (o ninguna).
// `reject`: direcciones que Javi ya ha descartado para esta tienda.
export function pick(cands, title, platform, { reject = [], ...opts } = {}) {
  const ok = cands.filter(c => !reject.includes(c.url));
  const rank = o => [...new Map(ok.map(c => [c.url, { ...c, s: score(c.label, title, platform, { ...opts, ...o }) }])).values()].filter(c => c.s !== null).sort((a, b) => b.s - a.s);
  let list = rank({}), loose = false;
  if (!list.length) { list = rank({ loose: true }); loose = true; }
  const best = list[0];
  if (!best) return null;
  const alts = list.slice(1).filter(c => c.s >= best.s - 10).slice(0, 3);
  const doubt = loose || alts.length > 0;
  return { ...best, doubt, options: doubt ? [best, ...alts].map(c => ({ url: c.url, title: (c.title || c.label).trim().slice(0, 160), ...(c.price && { price: c.price }) })) : null };
}
// Campos que una tienda añade a su resultado cuando la elección es dudosa.
export const doubtOf = best => (best.doubt ? { doubt: true, options: best.options } : {});

// Busca primero «juego plataforma» (en consolas la primera página suele ser de otras plataformas) y luego solo el juego.
async function searchKeys(search, title, platform, reject) {
  const terms = platform && platform !== 'PC' ? [`${title} ${platform}`, title] : [title];
  let other = false, fallback = null;
  for (const term of terms) {
    const cands = await search(term);
    const best = pick(cands, title, platform, { reject });
    // Un resultado seguro en la segunda búsqueda vale más que uno dudoso en la primera.
    if (best && !best.doubt) return best;
    fallback ||= best;
    other ||= !!pick(cands, title, '', { reject });
  }
  if (fallback) return fallback;
  throw new Error(other ? `no vende «${title}» para ${platform}, solo para otras plataformas` : `no encuentro «${title}» para ${platform}`);
}

// ---------- Instant Gaming ----------
export function igCandidates(html) {
  const out = [], seen = new Set();
  // El buscador devuelve los enlaces completos o relativos según cómo se cargue la página.
  const re = /href="(?:https:\/\/www\.instant-gaming\.com)?(\/es\/(\d+)-comprar-([a-z0-9-]+)\/?)"/gi;
  const hits = [...html.matchAll(re)];
  hits.forEach((m, i) => {
    if (seen.has(m[2])) return; seen.add(m[2]);
    m[1] = 'https://www.instant-gaming.com' + m[1];
    const chunk = html.slice(m.index, hits[i + 1]?.index ?? m.index + 3000);
    const title = chunk.match(/title="([^"]+)"/)?.[1] || chunk.match(/class="title"[^>]*>([^<]+)</)?.[1] || '';
    const price = web.parsePrice(chunk.match(/class="price"[^>]*>\s*([^<]+)</)?.[1]);
    out.push({ url: m[1], label: `${title} ${m[3]}`, title: title || m[3].replace(/-/g, ' '), price });
  });
  return out;
}

export async function instantGaming(title, platform, { reject = [] } = {}) {
  const search = async term => igCandidates((await web.page(`https://www.instant-gaming.com/es/busquedas/?q=${encodeURIComponent(term)}`, { forceBrowser: true, waitFor: 'a[href*="-comprar-"]' })).html);
  const best = await searchKeys(search, title, platform, reject);
  let price = best.price, out = false, pre = false, img = null;
  if (!price) ({ price, out, pre, image: img } = await web.product(best.url));
  return { name: 'Instant Gaming', type: 'key', url: best.url, price, out, pre, match: best.title, image: img, ...doubtOf(best) };
}

// ---------- Eneba ----------
export function enebaCandidates(html) {
  const out = [], seen = new Set();
  for (const m of html.matchAll(/href="(?:https:\/\/www\.eneba\.com)?\/es\/([a-z0-9][a-z0-9-]{6,})"/gi)) {
    const slug = m[1];
    if (seen.has(slug) || /^(store|collection|blog|support|promo|top-up|gift-cards?|giftcards?)\b/.test(slug)) continue;
    seen.add(slug);
    // Sin «currency» Eneba enseña la moneda del país desde el que se conecta (dólares desde GitHub).
    out.push({ url: `https://www.eneba.com/es/${slug}?currency=EUR`, label: slug, title: slug.replace(/-/g, ' ') });
  }
  return out;
}

export async function eneba(title, platform, { reject = [] } = {}) {
  const search = async term => enebaCandidates((await web.page(`https://www.eneba.com/es/store/all?text=${encodeURIComponent(term)}&currency=EUR`, { forceBrowser: true, waitFor: 'a[href*="/es/"]' })).html);
  const best = await searchKeys(search, title, platform, reject);
  const prod = await web.product(best.url);
  return { name: 'Eneba', type: 'key', url: best.url, price: prod.price, out: prod.out, pre: prod.pre, match: prod.title || best.title, image: prod.image, ...doubtOf(best) };
}

export const KEY_SHOPS = { 'Instant Gaming': instantGaming, Eneba: eneba };
