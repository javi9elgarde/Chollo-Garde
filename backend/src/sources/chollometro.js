// Chollometro: ofertas que comparte la comunidad. No es una tienda: cada oferta apunta a una tienda
// (Amazon, MediaMarkt…) con su precio. Se usa el buscador de la web, que publica cada oferta como JSON
// dentro de la página (data-vue3), y se queda con la oferta activa más barata que corresponde al
// juego y la plataforma. Responde bien desde GitHub, sin navegador ni captchas.
import * as web from './web.js';
import { score } from './keyshops.js';

const BASE = 'https://www.chollometro.com';
const MAX_AGE_DAYS = 45;

const decode = s => String(s || '').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Ofertas de una página de resultados del buscador.
export function deals(html) {
  const out = [];
  for (const m of html.matchAll(/data-vue3='([^']*ThreadMainListItemNormalizer[^']*)'/g)) {
    let t;
    try { t = JSON.parse(decode(m[1]))?.props?.thread; } catch { continue; }
    if (!t?.threadId || !t.title) continue;
    out.push({
      id: String(t.threadId),
      title: decode(t.title),
      price: web.parsePrice(t.price),
      ship: t.shipping?.isFree ? 0 : web.parsePrice(t.shipping?.price) || 0,
      merchant: t.merchant?.merchantName || t.linkHost?.replace(/^www\./, '') || null,
      expired: !!t.isExpired || (t.status && t.status !== 'Activated'),
      temperature: Math.round(t.temperature || 0),
      code: t.voucherCode || null,
      publishedAt: t.publishedAt ? t.publishedAt * 1000 : null,
      url: `${BASE}/ofertas/${t.titleSlug ? t.titleSlug + '-' : ''}${t.threadId}`
    });
  }
  return out;
}

// Mejor oferta activa para el juego y la plataforma, o null.
export function best(list, title, platform, now = Date.now()) {
  return list
    .filter(d => !d.expired && d.price && (!d.publishedAt || now - d.publishedAt < MAX_AGE_DAYS * 864e5))
    .filter(d => score(d.title, title, platform, { retail: true }) !== null)
    .sort((a, b) => (a.price + a.ship) - (b.price + b.ship))[0] || null;
}

export async function find(title, platform) {
  const terms = platform && platform !== 'PC' ? [`${title} ${platform}`, title] : [title];
  let seen = 0;
  for (const term of terms) {
    const p = await web.page(`${BASE}/search?q=${encodeURIComponent(term)}`);
    const list = deals(p.html);
    seen += list.length;
    const d = best(list, title, platform);
    if (d) {
      const extra = [d.merchant, d.code ? `código ${d.code}` : null, `${d.temperature}°`].filter(Boolean).join(' · ');
      return { name: 'Chollometro', type: 'deal', url: d.url, price: Math.round((d.price + d.ship) * 100) / 100, out: false, match: `${d.title} (${extra})` };
    }
  }
  throw new Error(seen ? `ninguna oferta activa de «${title}» para ${platform}` : 'el buscador no ha devuelto ofertas');
}
