// Tiendas conocidas: nombre bonito y tipo a partir del dominio del enlace.
// Cualquier otra tienda también vale: se usa su dominio como nombre y se lee su página igual.
const SHOPS = [
  { re: /(^|\.)amazon\.es$/, name: 'Amazon', type: 'retail', browser: true },
  { re: /(^|\.)mediamarkt\.es$/, name: 'MediaMarkt', type: 'retail', browser: true },
  { re: /(^|\.)fnac\.es$/, name: 'Fnac', type: 'retail', browser: true },
  { re: /(^|\.)elcorteingles\.es$/, name: 'El Corte Inglés', type: 'retail', browser: true },
  { re: /(^|\.)game\.es$/, name: 'GAME', type: 'retail' },
  { re: /(^|\.)impactgame\.es$/, name: 'Impact', type: 'retail' },
  { re: /(^|\.)carrefour\.es$/, name: 'Carrefour', type: 'retail', browser: true },
  { re: /(^|\.)xtralife\.com$/, name: 'xtralife', type: 'retail' },
  { re: /(^|\.)instant-gaming\.com$/, name: 'Instant Gaming', type: 'key' },
  { re: /(^|\.)eneba\.com$/, name: 'Eneba', type: 'key', browser: true },
  { re: /(^|\.)store\.steampowered\.com$/, name: 'Steam', type: 'official' },
  { re: /(^|\.)playstation\.com$/, name: 'PS Store', type: 'official', browser: true },
  { re: /(^|\.)nintendo\.com$/, name: 'Nintendo eShop', type: 'official', browser: true },
  { re: /(^|\.)xbox\.com$/, name: 'Xbox Store', type: 'official', browser: true }
];

export function parseUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
    return /\./.test(u.hostname) ? u : null;
  } catch { return null; }
}

export function shopFor(url) {
  const u = typeof url === 'string' ? parseUrl(url) : url;
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const hit = SHOPS.find(s => s.re.test(host));
  if (hit) return { name: hit.name, type: hit.type, browser: !!hit.browser };
  const bare = host.replace(/^www\./, '');
  return { name: bare, type: 'retail', browser: false };
}
