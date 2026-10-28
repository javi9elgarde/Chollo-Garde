// PlayStation Store España: tienda oficial de los juegos de PS5 y PS4 (como Steam en PC). Su precio
// sirve de referencia: «vs oficial» en la ficha y precio de lanzamiento (el precio base, sin rebaja).
// El buscador se pinta con JavaScript, así que se abre con el navegador; la ficha trae el precio en
// JSON-LD y el precio base en los datos de la página.
import * as web from './web.js';
import { candidates } from './retail.js';
import { pick } from './keyshops.js';

const BASE = 'https://store.playstation.com/es-es';
const SHOP = { product: /^\/es-es\/product\/[A-Z0-9_-]+$/i };
// El código del producto dice la consola: PPSA… es de PS5 y CUSA… de PS4.
const platOf = url => (/-PPSA\d/i.test(url) ? 'PS5' : /-CUSA\d/i.test(url) ? 'PS4' : '');

export const covers = platform => platform === 'PS5' || platform === 'PS4';

// Precio base (sin rebaja) de la ficha, en euros, o null.
export function basePrice(html, price) {
  const vals = [...html.matchAll(/"basePriceValue":(\d+),"discountedValue":(\d+)/g)].map(m => [+m[1] / 100, +m[2] / 100]);
  // El de este producto es el que tiene el mismo precio actual que la ficha.
  return (vals.find(([, d]) => d === price) || vals[0] || [])[0] || null;
}

export async function find(title, platform, { reject = [] } = {}) {
  const p = await web.page(`${BASE}/search/${encodeURIComponent(title)}`, { forceBrowser: true, waitFor: 'a[href*="/product/"]' });
  const cands = candidates(p.html, p.url, SHOP).map(c => ({ ...c, label: `${c.label} ${platOf(c.url)}` }));
  const best = pick(cands, title, platform, { reject });
  if (!best) throw new Error(cands.length ? `no encuentro «${title}» para ${platform} entre ${cands.length} resultados` : 'el buscador no ha devuelto productos');
  const page = await web.page(best.url, { forceBrowser: true });
  const prod = web.extract(page.html, best.url);
  const initial = basePrice(page.html, prod.price);
  return { name: 'PS Store', type: 'official', url: best.url, price: prod.price, initial: initial && initial > prod.price ? initial : prod.price, out: false, pre: prod.pre, match: prod.title || best.title, image: prod.image };
}
