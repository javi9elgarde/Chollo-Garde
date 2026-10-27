// Lector genérico de fichas de producto de cualquier tienda.
// 1) Descarga la página como un navegador normal; si la tienda la bloquea (o es de las protegidas), la abre
//    con un navegador real. 2) Saca título, imagen, precio y disponibilidad de los datos estructurados
//    (JSON-LD schema.org, que casi todas las tiendas publican para Google), de las metaetiquetas o,
//    para Amazon, de su HTML.
import { get } from '../store.js';
import { track } from '../http.js';
import * as browser from './browser.js';
import { shopFor, parseUrl } from './shops.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

// Se puede sustituir en las pruebas.
let fetcher = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-ES,es;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  return { html: await res.text(), url: res.url, status: res.status };
};
let renderer = (url, opts) => browser.render(url, opts);
export function _setFetchers({ fetch: f, render: r } = {}) { if (f) fetcher = f; if (r) renderer = r; }

export function blocked(html = '', status = 200) {
  if (status === 403 || status === 429 || status === 503) return true;
  return /captcha-delivery\.com|validateCaptcha|\/errors\/validateCaptcha|cf-chl-|Just a moment\.\.\.|Attention Required! \| Cloudflare|px-captcha|Access Denied<\/title>/i.test(html);
}

// Descarga la página. `forceBrowser` para tiendas que siempre bloquean las descargas simples.
export async function page(url, { forceBrowser = false, waitFor = null } = {}) {
  get().stats.requests++;
  if (!forceBrowser) {
    const t0 = Date.now();
    try {
      const r = await fetcher(url);
      const ok = !blocked(r.html, r.status) && r.status < 400;
      track(url, ok, Date.now() - t0);
      if (ok) return { ...r, via: 'http' };
    } catch { track(url, false, Date.now() - t0); }
  }
  const t0 = Date.now();
  let r;
  try { r = await renderer(url, { waitFor }); } catch (e) { track(url, false, Date.now() - t0); throw e; }
  const bad = blocked(r.html, r.status) || r.status >= 400;
  track(url, !bad, Date.now() - t0);
  if (blocked(r.html, r.status)) throw new Error('la tienda ha pedido un captcha; se reintentará en el próximo ciclo');
  if (r.status >= 400) throw new Error(`la tienda respondió ${r.status}`);
  return { ...r, via: 'navegador' };
}

// ---------- extracción ----------
const decode = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();

// «1.299,00 €», «59,99», «59.99», «59,99€» → número
export function parsePrice(v) {
  if (typeof v === 'number') return v > 0 ? v : null;
  let s = String(v ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > ld) s = s.replace(/\./g, '').replace(',', '.');           // formato español
  else if (ld > lc && lc >= 0) s = s.replace(/,/g, '');               // 1,299.00
  else if (ld >= 0 && s.length - ld - 1 === 3 && s.split('.').length === 2 && !/^0/.test(s)) s = s.replace('.', ''); // 1.299
  const n = parseFloat(s);
  return n > 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
}

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1].trim())); } catch {
      try { out.push(JSON.parse(m[1].trim().replace(/[\u0000-\u001f]+/g, ' '))); } catch {}
    }
  }
  const flat = [];
  const walk = x => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk); flat.push(x); if (x['@graph']) walk(x['@graph']); };
  walk(out);
  return flat;
}

const isProduct = o => [].concat(o['@type'] || []).some(t => /^(Product|VideoGame|ProductGroup|SoftwareApplication|IndividualProduct)$/i.test(t));
const AVAIL_OUT = /OutOfStock|SoldOut|Discontinued/i;

function offerOf(p) {
  const offers = [].concat(p.offers || [], p.hasVariant ? [].concat(p.hasVariant).flatMap(v => [].concat(v.offers || [])) : []).flatMap(o => o && o['@type'] === 'AggregateOffer' && o.offers ? [o, ...[].concat(o.offers)] : [o]).filter(Boolean);
  let best = null;
  for (const o of offers) {
    const price = parsePrice(o.lowPrice ?? o.price ?? o.priceSpecification?.price);
    const cur = o.priceCurrency || o.priceSpecification?.priceCurrency || 'EUR';
    if (!price || (cur && cur !== 'EUR')) continue;
    const out = AVAIL_OUT.test(String(o.availability || ''));
    if (!best || (best.out && !out) || (best.out === out && price < best.price)) best = { price, out, url: o.url || null };
  }
  return best;
}

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1]) : null;
}

function amazon(html) {
  const blk = html.match(/id="(?:corePriceDisplay_desktop_feature_div|corePrice_feature_div|apex_desktop)"[\s\S]{0,6000}/)?.[0] || '';
  const priceTxt = blk.match(/class="a-offscreen">([^<]+)</)?.[1] || html.match(/id="priceblock_(?:ourprice|dealprice|saleprice)"[^>]*>([^<]+)</)?.[1];
  const title = decode(html.match(/id="productTitle"[^>]*>([\s\S]*?)<\/span>/)?.[1]);
  const image = html.match(/id="landingImage"[^>]*data-old-hires="([^"]+)"/)?.[1] || html.match(/id="landingImage"[^>]*src="([^"]+)"/)?.[1] || null;
  const avail = decode(html.match(/id="availability"[\s\S]{0,400}?<span[^>]*>([\s\S]*?)<\/span>/)?.[1]);
  return { price: parsePrice(priceTxt), title, image, out: /no disponible|agotado/i.test(avail) };
}

// Devuelve { title, image, price, out } o lanza un error explicando qué falta.
export function extract(html, url) {
  const host = parseUrl(url)?.hostname || '';
  let title = null, image = null, price = null, out = false;
  if (/amazon\./.test(host)) ({ title, image, price, out } = amazon(html));
  if (!price) {
    for (const p of jsonLd(html).filter(isProduct)) {
      const o = offerOf(p);
      if (!o) continue;
      price = o.price; out = o.out;
      title = title || decode(p.name);
      image = image || [].concat(p.image || []).map(i => (typeof i === 'string' ? i : i?.url)).find(Boolean) || null;
      break;
    }
  }
  if (!price) {
    price = parsePrice(meta(html, 'product:price:amount') || meta(html, 'og:price:amount') || meta(html, 'price'));
    const cur = meta(html, 'product:price:currency') || meta(html, 'og:price:currency');
    if (cur && cur !== 'EUR') price = null;
  }
  title = title || meta(html, 'og:title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || null;
  image = image || meta(html, 'og:image') || null;
  if (!price) throw new Error('no encuentro el precio en la página (¿es la ficha de un producto?)');
  return { title: title ? title.slice(0, 160) : null, image, price, out };
}

// Lee la ficha de producto de un enlace pegado por el usuario.
export async function product(rawUrl) {
  const u = parseUrl(rawUrl);
  if (!u) throw new Error('enlace no válido');
  const shop = shopFor(u);
  const p = await page(u.href, { forceBrowser: shop.browser, waitFor: /amazon\./.test(u.hostname) ? '#productTitle' : null });
  return { ...extract(p.html, p.url), shop, url: u.href, via: p.via };
}
