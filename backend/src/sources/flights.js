// Vuelos con precio real: Google Flights. No necesita clave ni cuenta y responde bien desde GitHub sin navegador.
// La búsqueda va codificada en el parámetro «tfs» de la dirección (un mensaje protobuf en base64, el mismo que
// genera la web al buscar). La página llega ya con los resultados: cada vuelo lleva una descripción accesible
// («From 369 euros round trip total. Nonstop flight with Delta. Leaves … Total duration 9 hr 3 min.») que se lee
// pidiendo la página en inglés, y además Google dice si los precios están bajos, normales o altos para esa ruta.
import { get } from '../store.js';
import { track } from '../http.js';
import * as browser from './browser.js';

const BASE = 'https://www.google.com/travel/flights';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
// Consentimiento de cookies ya aceptado (si no, desde Europa Google enseña antes su pantalla de cookies).
const COOKIES = 'CONSENT=YES+cb.20240101-00-p0.es+FX+000; SOCS=CAESHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmVzIAEaBgiA_bmtBg';

// ---------- dirección de búsqueda ----------
const varint = n => { const b = []; while (n > 127) { b.push((n & 127) | 128); n = Math.floor(n / 128); } b.push(n); return b; };
const key = (f, w) => varint(f * 8 + w);
const bytes = (f, b) => [...key(f, 2), ...varint(b.length), ...b];
const str = (f, s) => bytes(f, [...Buffer.from(String(s))]);
const int = (f, n) => [...key(f, 0), ...varint(n)];
const airport = code => [...int(1, 1), ...str(2, code)];

// legs: [{ date: 'AAAA-MM-DD', from: 'MAD', to: 'BCN' }] (dos tramos = ida y vuelta).
export function tfs({ legs, adults = 1, maxStops = null }) {
  const out = [...int(1, 28), ...int(2, 2)];
  for (const l of legs) out.push(...bytes(3, [...str(2, l.date), ...(maxStops != null ? int(5, maxStops) : []), ...bytes(13, airport(l.from)), ...bytes(14, airport(l.to))]));
  out.push(...bytes(8, Array(Math.max(1, Math.min(9, adults))).fill(1)), ...int(9, 1), ...int(19, legs.length > 1 ? 1 : 2));
  return Buffer.from(out).toString('base64');
}

export function legsOf(q) {
  const legs = [{ date: q.depart, from: q.origin, to: q.dest }];
  if (q.ret) legs.push({ date: q.ret, from: q.dest, to: q.origin });
  return legs;
}

// `hl=en` para leer los resultados; la dirección que se enseña a Javi va en español.
export function searchUrl(q, lang = 'es') {
  return `${BASE}?tfs=${encodeURIComponent(tfs({ legs: legsOf(q), adults: q.adults, maxStops: q.maxStops }))}&hl=${lang}&gl=ES&curr=EUR`;
}

// ---------- lectura de la página ----------
const decode = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;| /g, ' ');

function minutes(txt) {
  const h = +(txt.match(/(\d+)\s*hr/)?.[1] || 0), m = +(txt.match(/(\d+)\s*min/)?.[1] || 0);
  return h * 60 + m || null;
}
// «1:10 PM» → «13:10»
function hhmm(t) {
  const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
  if (!m) return null;
  let h = +m[1];
  if (m[3]) { const pm = /p/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// Un vuelo a partir de su descripción. Devuelve null si no es la descripción de un vuelo.
export function parseLabel(label) {
  const s = decode(label).replace(/\s+/g, ' ').trim();
  const price = s.match(/^(?:From )?([\d,]+) euros?\b/i);
  const fl = s.match(/\b(Nonstop|(\d+) stops?) flight with (.+?)\.(?= Leaves| Operated|$)/i);
  if (!price || !fl) return null;
  const leg = s.match(/Leaves (.+?) at ([\d:]+\s?[AP]M) on [A-Za-z]+, ([A-Za-z]+ \d+) and arrives at (.+?) at ([\d:]+\s?[AP]M) on [A-Za-z]+, ([A-Za-z]+ \d+)/i);
  const via = [...s.matchAll(/Layover \(\d+ of \d+\) is an? (.+?) layover at (.+?)(?: in ([^.]+))?\./gi)].map(m => ({ city: (m[3] || m[2]).trim(), airport: m[2].trim(), min: minutes(m[1]), overnight: /overnight/i.test(m[1]) }));
  return {
    price: +price[1].replace(/,/g, ''),
    stops: /nonstop/i.test(fl[1]) ? 0 : +fl[2],
    airline: fl[3].replace(/^(?:an? )?/, '').trim(),
    from: leg?.[1] || null, depTime: hhmm(leg?.[2]), depDay: leg?.[3] || null,
    to: leg?.[4] || null, arrTime: hhmm(leg?.[5]), arrDay: leg?.[6] || null,
    durMin: minutes(s.match(/Total duration ([^.]+)\./i)?.[1] || ''),
    via,
    // Tarifas «básicas» que no dejan subir la maleta de mano al compartimento superior.
    noCabinBag: /not include (?:overhead bin|a carry-on|carry-on)/i.test(s),
    label: s
  };
}

export function parse(html) {
  const seen = new Set(), flights = [];
  for (const m of html.matchAll(/aria-label="([^"]*euros?[^"]*flight with[^"]*)"/gi)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const f = parseLabel(m[1]);
    if (f) flights.push(f);
  }
  flights.sort((a, b) => a.price - b.price || a.durMin - b.durMin);
  const level = html.match(/Prices are currently\s*(?:<[^>]+>)*\s*(low|typical|high)/i)?.[1]?.toLowerCase() || null;
  // «… usually cost between €45 and €120» (no siempre aparece).
  const r = decode(html).match(/usually cost between\s*(?:<[^>]+>)*\s*€\s?([\d,]+)\s*(?:<[^>]+>)*\s*(?:and|–|-)\s*(?:<[^>]+>)*\s*€\s?([\d,]+)/i);
  const typical = r ? { lo: +r[1].replace(/,/g, ''), hi: +r[2].replace(/,/g, '') } : null;
  return { flights, level, typical };
}

// ---------- búsqueda ----------
let fetcher = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9', Cookie: COOKIES }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  return { html: await res.text(), url: res.url, status: res.status };
};
export function _setFetcher(f) { fetcher = f; }

// Busca un día concreto. Si la descarga simple no trae vuelos (cookies, bloqueo…), se prueba con el navegador.
export async function search(q) {
  const url = searchUrl(q, 'en');
  const attempt = async (how) => {
    get().stats.requests++;
    const t0 = Date.now();
    try {
      const r = how === 'http' ? await fetcher(url) : await browser.render(url, { waitFor: '[aria-label*="flight with"]' });
      const p = r.status < 400 ? parse(r.html) : { flights: [] };
      track(url, p.flights.length > 0, Date.now() - t0);
      if (r.status >= 400) throw new Error(`Google Flights respondió ${r.status}`);
      if (/consent\.google|before you continue/i.test(r.url + r.html.slice(0, 5000)) && !p.flights.length) throw new Error('Google ha pedido aceptar las cookies');
      return p;
    } catch (e) { track(url, false, Date.now() - t0); throw e; }
  };
  let p, err;
  try { p = await attempt('http'); } catch (e) { err = e; }
  if (!p?.flights.length && process.env.FLIGHTS_BROWSER !== '0') {
    try { p = await attempt('browser'); } catch (e) { err = err || e; }
  }
  if (!p) throw err;
  if (q.maxStops != null) p.flights = p.flights.filter(f => f.stops <= q.maxStops);
  return { ...p, url: searchUrl(q, 'es') };
}
