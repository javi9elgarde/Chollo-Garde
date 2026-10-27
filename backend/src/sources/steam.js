// Tienda de Steam en España: precio real en euros, portada, valoraciones y compatibilidad con Steam Deck.
// Son endpoints públicos de la web de Steam (sin clave); si alguno falla, el tracker sigue con CheapShark.
import { config } from '../config.js';
import { getJson } from '../http.js';

const base = () => config.steamStoreBase;

export function appIdFromUrl(u) {
  const m = String(u).match(/store\.steampowered\.com\/(?:agecheck\/)?app\/(\d+)/i) || String(u).match(/steamcommunity\.com\/app\/(\d+)/i);
  return m ? m[1] : null;
}
export const appUrl = id => `https://store.steampowered.com/app/${id}/`;

// Precio en EUR (céntimos → euros). null si es gratis, no está a la venta o falla.
export async function priceEs(appId) {
  const r = await getJson(`${base()}/api/appdetails?appids=${appId}&cc=es&l=spanish&filters=price_overview`);
  const d = r?.[appId];
  if (!d?.success || !d.data || Array.isArray(d.data) || !d.data.price_overview) return null;
  const p = d.data.price_overview;
  if (p.currency !== 'EUR') return null;
  return { price: p.final / 100, initial: p.initial / 100, discount: p.discount_percent };
}

export async function details(appId) {
  const r = await getJson(`${base()}/api/appdetails?appids=${appId}&cc=es&l=spanish`);
  const d = r?.[appId];
  if (!d?.success || !d.data) return null;
  const x = d.data, p = x.price_overview;
  return {
    name: x.name,
    image: x.header_image || null,
    free: !!x.is_free,
    price: p && p.currency === 'EUR' ? { price: p.final / 100, initial: p.initial / 100, discount: p.discount_percent } : null,
    genres: (x.genres || []).map(g => g.description).slice(0, 3),
    metacritic: x.metacritic?.score || null,
    developer: (x.developers || [])[0] || null,
    release: x.release_date?.date || null
  };
}

export async function reviews(appId) {
  try {
    const r = await getJson(`${base()}/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=1&filter=all`, { retries: 0 });
    const q = r?.query_summary;
    if (!q || !q.total_reviews) return null;
    return { rating: Math.round(q.total_positive / q.total_reviews * 50) / 10, n: q.total_reviews, desc: q.review_score_desc };
  } catch { return null; }
}

const DECK = { 1: 'No compatible', 2: 'Jugable', 3: 'Verificado' };
export async function deck(appId) {
  try {
    const r = await getJson(`${base()}/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${appId}`, { retries: 0 });
    return DECK[r?.results?.resolved_category] || null;
  } catch { return null; }
}
