// Búsqueda automática en las tiendas generalistas que usa Javi (Amazon, MediaMarkt, Fnac, El Corte Inglés,
// GAME e Impact). Abre el buscador de la tienda, se queda con los enlaces a fichas de producto, elige la que
// corresponde al juego y la plataforma (edición estándar antes que coleccionista, sin segunda mano ni
// accesorios) y lee el precio de esa ficha.
import * as web from './web.js';
import { pick } from './keyshops.js';

const q = s => encodeURIComponent(s);

export const RETAIL = {
  Amazon: {
    search: t => `https://www.amazon.es/s?k=${q(t)}&i=videogames`,
    product: /\/dp\/([A-Z0-9]{10})/,
    canon: (u, m) => `https://www.amazon.es/dp/${m[1]}`,
    browser: true, waitFor: '[data-component-type="s-search-result"]'
  },
  MediaMarkt: {
    search: t => `https://www.mediamarkt.es/es/search.html?query=${q(t)}`,
    product: /\/es\/product\/_[^/?#]+\.html/i,
    browser: true, waitFor: 'a[href*="/es/product/"]'
  },
  Fnac: {
    search: t => `https://www.fnac.es/SearchResult/ResultList.aspx?Search=${q(t)}`,
    product: /\/(?:mp)?a\d+(?:\/|$)/i,
    browser: true, waitFor: 'a[href*="fnac.es/a"], a[href*="fnac.es/mp"]'
  },
  'El Corte Inglés': {
    search: t => `https://www.elcorteingles.es/search-nwx/1/?s=${q(t)}`,
    product: /\/videojuegos\/A\d+/i,
    browser: true, waitFor: 'a[href*="/videojuegos/A"]'
  },
  GAME: {
    search: t => `https://www.game.es/buscar/${q(t)}`,
    product: /\/\d{5,}\/?$/,
    browser: false
  },
  Impact: {
    search: t => `https://impactgame.es/busqueda?controller=search&s=${q(t)}`,
    product: null,
    browser: false
  }
};
export const RETAIL_NAMES = Object.keys(RETAIL);

const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
const attr = (tag, name) => decode(tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1]);
const text = html => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const host = h => h.toLowerCase().replace(/^www\./, '');
const NOT_PRODUCT = /\/(buscar|busqueda|search|searchresult|s|categoria|category|marcas?|brand|login|cuenta|account|cart|carrito|ayuda|help)(\/|$|\?)/i;

// Enlaces a fichas de producto de una página de resultados, con el texto que los acompaña.
export function candidates(html, pageUrl, shop) {
  const base = new URL(pageUrl), out = new Map();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], 'href');
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
    let u;
    try { u = new URL(href, base); } catch { continue; }
    if (host(u.hostname) !== host(base.hostname)) continue;
    let key;
    if (shop.product) {
      const pm = u.pathname.match(shop.product);
      if (!pm) continue;
      key = shop.canon ? shop.canon(u, pm) : u.origin + u.pathname;
    } else {
      // Tienda sin patrón conocido: cualquier enlace interno con pinta de ficha (ruta larga, sin buscador).
      if (NOT_PRODUCT.test(u.pathname) || u.pathname.split('/').filter(Boolean).at(-1)?.length < 8) continue;
      key = u.origin + u.pathname;
    }
    const label = [text(m[2]), attr(m[1], 'title'), attr(m[1], 'aria-label'), ...[...m[2].matchAll(/\balt=["']([^"']+)["']/gi)].map(a => decode(a[1]))].filter(Boolean).join(' ');
    const c = out.get(key) || { url: key, label: '', title: '' };
    c.label += ' ' + label;
    if (!c.title || (label && label.length > c.title.length && label.length < 200)) c.title = label || c.title;
    out.set(key, c);
  }
  // El nombre del producto suele ir también en la propia dirección.
  return [...out.values()].map(c => ({ ...c, label: `${c.label} ${decodeURIComponent(new URL(c.url).pathname).replace(/[-_/]+/g, ' ')}`, title: c.title.slice(0, 160) }));
}

// Busca el juego en una tienda y lee el precio de la mejor ficha. Lanza un error explicando qué ha fallado.
export async function find(name, title, platform) {
  const shop = RETAIL[name];
  const p = await web.page(shop.search(`${title} ${platform}`), { forceBrowser: shop.browser, waitFor: shop.waitFor });
  let cands = candidates(p.html, p.url, shop);
  let best = pick(cands, title, platform, { retail: true });
  if (!best) {
    // Algunas tiendas no encuentran nada si se añade la plataforma: se repite solo con el nombre.
    const p2 = await web.page(shop.search(title), { forceBrowser: shop.browser, waitFor: shop.waitFor });
    cands = candidates(p2.html, p2.url, shop);
    best = pick(cands, title, platform, { retail: true });
  }
  if (!best) throw new Error(cands.length ? `no encuentro «${title}» para ${platform} entre ${cands.length} resultados` : 'el buscador de la tienda no ha devuelto productos');
  const prod = await web.product(best.url);
  return { name, type: 'retail', url: best.url, price: prod.price, out: prod.out, match: prod.title || best.title, image: prod.image };
}
