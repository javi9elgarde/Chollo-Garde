// Fase 3 · IA con Gemini. En cada ciclo, para cada juego:
// - Deal Index y recomendación (comprar ya, esperar o precio inflado) con el histórico propio y los precios de cada tienda.
// - Pros y contras de las reseñas: las de Steam en PC; en consola, Gemini las busca con Google.
// El Co-Piloto y el comparador llaman a `chat()` (servidor del PC) o directamente a Gemini desde el panel (GitHub).
// Sin GEMINI_API_KEY no se hace nada y el panel sigue con su heurística local.
import { config } from './config.js';
import { get } from './store.js';
import { log } from './bus.js';
import * as steam from './sources/steam.js';

const DAY = 864e5;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dayKey = t => new Date(t).toLocaleDateString('sv-SE');
// Sube este número si cambian los prompts: los análisis guardados se rehacen en el siguiente ciclo.
const VERSION = 1;
const LIMITS = { deals: 12, reviews: 3 }; // por ciclo, para no pasar de la cuota gratuita (unas 250 peticiones al día)

export const enabled = () => !!config.gemini.key;

export class AiError extends Error {}

export const PROMPTS = {
  deal: `Eres el auditor de precios de CholloGarde, un rastreador de videojuegos para un comprador en España.
Recibes en JSON un juego, su plataforma, el precio actual, el objetivo del usuario, el precio de cada tienda y el histórico propio (un punto por día, el más bajo de ese día).
Reglas:
- Usa solo las cifras que recibes. Nunca inventes precios, fechas ni tiendas.
- «precio_referencia» es el precio oficial o de lanzamiento. Las tiendas de tipo «key» (Instant Gaming, Eneba) son revendedores de claves digitales.
- Detecta si el precio se infló en los 30 días previos a la bajada actual (subida y luego «oferta» que solo vuelve al precio habitual).
- Ten en cuenta el calendario: Black Friday (último viernes de noviembre), rebajas de Steam (otoño a finales de noviembre, invierno a finales de diciembre, primavera en marzo, verano a finales de junio), Días de Juego de PlayStation (finales de mayo y junio) y las rebajas de enero.
- Con menos de 7 días de histórico, dilo y baja la confianza.
- Escribe en español de España, frases cortas con cifras en euros (formato 12,34 €).
Devuelve SOLO JSON: {"score": entero 1-100 (100 = chollo real), "inflado": bool, "descuento_real": número 0-1 frente al precio habitual, "recomendacion": "COMPRAR_AHORA" | "ESPERAR_BAJADA" | "PRECIO_INFLADO", "confianza": número 0-1, "motivos": [2 a 4 frases], "proxima_bajada": frase corta sobre cuándo podría bajar, o null}`,
  reviews: `Resume en español de España lo que opinan los jugadores del juego que se indica, a partir de las reseñas que recibes. No inventes nada que no aparezca en ellas.
Devuelve SOLO JSON: {"pros": [3 frases cortas], "contras": [3 frases cortas], "nota": número 0-5 con un decimal}`,
  reviewsSearch: `Busca en Google reseñas de usuarios y de prensa del videojuego que se indica, en la plataforma indicada, y resume lo que se dice. No inventes nada que no encuentres.
Responde SOLO con un objeto JSON, sin texto alrededor: {"pros": [3 frases cortas en español], "contras": [3 frases cortas en español], "nota": número 0-5 con un decimal según la media de las valoraciones}`
};

// ---------- cliente de Gemini ----------
let model = null;
// Sin GEMINI_MODEL: el Flash estable con el número de versión más alto (los «preview» y «exp» no cuentan).
async function pickModel() {
  if (model) return model;
  if (config.gemini.model) return (model = config.gemini.model.replace(/^models\//, ''));
  try {
    const r = await fetch(`${config.gemini.base}/models?pageSize=1000`, { headers: { 'x-goog-api-key': config.gemini.key }, signal: AbortSignal.timeout(15000) });
    const list = r.ok ? (await r.json()).models || [] : [];
    const best = list
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => ({ name: m.name.replace(/^models\//, ''), v: +(m.name.match(/^models\/gemini-(\d+(?:\.\d+)?)-flash$/) || [])[1] }))
      .filter(m => m.v).sort((a, b) => b.v - a.v)[0];
    model = best ? best.name : 'gemini-2.5-flash';
  } catch { model = 'gemini-2.5-flash'; }
  return model;
}
export const modelName = () => model || config.gemini.model || null;

// Saca el objeto JSON de la respuesta aunque venga entre ```json … ``` o con texto alrededor.
export function parseJson(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  throw new AiError('Gemini no ha devuelto un JSON válido');
}

// Una llamada a Gemini. `history`: [{ role: 'user' | 'model', text }]. `search`: con búsqueda de Google.
export async function generate({ system, prompt, history = [], json = true, search = false, temperature = 0.3 }) {
  if (!enabled()) throw new AiError('Falta GEMINI_API_KEY');
  const m = await pickModel();
  const body = {
    ...(system && { systemInstruction: { parts: [{ text: system }] } }),
    contents: [...history.map(h => ({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text) }] })), { role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, ...(json && !search && { responseMimeType: 'application/json' }) },
    ...(search && { tools: [{ google_search: {} }] })
  };
  for (let attempt = 0; ; attempt++) {
    get().stats.requests++;
    let res;
    try {
      res = await fetch(`${config.gemini.base}/models/${m}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    } catch (e) {
      if (attempt < 1) { await sleep(3000); continue; }
      throw new AiError(`Sin respuesta de Gemini: ${e.message}`);
    }
    if (res.ok) {
      const data = await res.json();
      const c = data.candidates?.[0];
      const text = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
      if (!text) throw new AiError(`Gemini no ha respondido (${c?.finishReason || data.promptFeedback?.blockReason || 'vacío'})`);
      const sources = [...new Set((c.groundingMetadata?.groundingChunks || []).map(g => g.web?.title).filter(Boolean))];
      return { text, data: json ? parseJson(text) : null, sources, model: m };
    }
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || `HTTP ${res.status}`;
    if ((res.status === 429 || res.status >= 500) && attempt < 1) {
      const wait = +(String(err.error?.details?.find(d => d.retryDelay)?.retryDelay || '').replace('s', '')) || 15;
      if (wait <= 40) { await sleep(wait * 1000); continue; }
    }
    if (res.status === 429) throw new AiError('Cuota de Gemini agotada por ahora; se reintenta en el siguiente ciclo');
    if (res.status === 400 && /API key/i.test(msg)) throw new AiError('GEMINI_API_KEY no es válida');
    throw new AiError(`Gemini: ${msg.slice(0, 200)}`);
  }
}

// Co-Piloto y comparador del servidor del PC: el panel manda el prompt de sistema y los datos.
export async function chat({ system, prompt, history, json }) {
  const r = await generate({ system, prompt, history: (history || []).slice(-10), json: !!json, temperature: 0.5 });
  return { text: r.text, data: r.data, model: r.model };
}

// ---------- análisis de cada juego ----------
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const strs = (a, n, len = 280) => (Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, len)).slice(0, n) : []);
const RECS = ['COMPRAR_AHORA', 'ESPERAR_BAJADA', 'PRECIO_INFLADO'];

// Histórico compacto: el precio más bajo de cada día, los últimos 180 días.
function daily(it) {
  const days = new Map();
  for (const h of it.history || []) { const k = dayKey(h.t); if (!days.has(k) || h.p < days.get(k)) days.set(k, h.p); }
  return [...days].slice(-180).map(([fecha, precio]) => ({ fecha, precio }));
}

export function dealPayload(it, now = Date.now()) {
  const hist = daily(it);
  return {
    hoy: dayKey(now),
    titulo: it.title, plataforma: it.platform,
    precio_actual: it.current, objetivo_del_usuario: it.target,
    precio_referencia: it.msrp || null,
    minimo_registrado: hist.length ? Math.min(...hist.map(h => h.precio)) : it.current,
    dias_de_historico: hist.length,
    tiendas: (it.stores || []).filter(s => s.price && !s.error).map(s => ({ tienda: s.name, tipo: s.type || 'retail', precio: s.price, ...(s.out && { agotado: true }), ...(s.pre && { reserva: true }), ...(s.stale && { precio_antiguo: true }), ...(s.doubt && { ficha_dudosa: true }) })),
    historico: hist
  };
}

function cleanDeal(d) {
  const rec = RECS.includes(d.recomendacion) ? d.recomendacion : d.inflado ? 'PRECIO_INFLADO' : 'ESPERAR_BAJADA';
  const motivos = strs(d.motivos, 4);
  if (!motivos.length) throw new AiError('Gemini no ha dado motivos');
  return {
    score: Math.round(num(d.score, 1, 100, 50)), inflado: !!d.inflado, descuento_real: num(d.descuento_real, -1, 1, 0),
    recomendacion: rec, confianza: num(d.confianza, 0, 1, 0.5), motivos,
    proxima_bajada: typeof d.proxima_bajada === 'string' && d.proxima_bajada.trim() ? d.proxima_bajada.trim().slice(0, 200) : null
  };
}

export async function analyzeDeal(it) {
  const r = await generate({ system: PROMPTS.deal, prompt: JSON.stringify(dealPayload(it)) });
  it.ai = { ...cleanDeal(r.data), price: it.current, at: Date.now(), model: r.model, v: VERSION };
  return it.ai;
}

// Textos de reseñas de Steam (en español y, si hay pocas, en inglés).
async function steamTexts(appId) {
  const base = config.steamStoreBase, out = [];
  for (const lang of ['spanish', 'english']) {
    try {
      const res = await fetch(`${base}/appreviews/${appId}?json=1&language=${lang}&num_per_page=40&filter=all&purchase_type=all&review_type=all`, { signal: AbortSignal.timeout(15000) });
      const j = res.ok ? await res.json() : null;
      for (const x of j?.reviews || []) if (x.review && x.review.length > 40) out.push(`${x.voted_up ? '👍' : '👎'} ${x.review.replace(/\s+/g, ' ').slice(0, 600)}`);
    } catch {}
    if (out.length >= 15) break;
  }
  return out.slice(0, 40);
}

export async function analyzeReviews(it) {
  let r, src;
  const texts = it.steamAppID ? await steamTexts(it.steamAppID) : [];
  if (texts.length >= 5) {
    r = await generate({ system: PROMPTS.reviews, prompt: JSON.stringify({ juego: it.title, plataforma: it.platform, resenas_de_steam: texts }) });
    src = 'Steam';
  } else {
    r = await generate({ system: PROMPTS.reviewsSearch, prompt: `Juego: «${it.title}». Plataforma: ${it.platform}.`, search: true });
    src = r.sources.slice(0, 3).join(', ') || 'Google';
  }
  const pros = strs(r.data.pros, 3, 140), cons = strs(r.data.contras, 3, 140);
  if (!pros.length && !cons.length) throw new AiError('Gemini no ha encontrado reseñas');
  const rev = it.reviews || { rating: null, n: 0 };
  const nota = num(r.data.nota, 0, 5, null);
  it.reviews = {
    ...rev, pros, cons,
    rating: rev.rating ?? (nota == null ? null : Math.round(nota * 10) / 10),
    src: rev.n ? rev.src.replace(/ · resumen de Gemini.*$/, '') + ' · resumen de Gemini' : `Gemini con ${src}`,
    ai: { at: Date.now(), model: r.model, from: src }
  };
  return it.reviews;
}

const needsDeal = (it, now) => !it.ai || it.ai.v !== VERSION || it.ai.price !== it.current || now - it.ai.at > DAY;
const needsReviews = (it, now) => !it.reviews?.ai || now - it.reviews.ai.at > 7 * DAY;

// Después de cada ciclo: analiza los juegos cuyo precio ha cambiado o cuyo análisis tiene más de un día.
// `force`: el botón «Regenerar» del panel (rehace las dos cosas de ese tracker).
export async function refresh(list, { force = false } = {}) {
  const db = get(), now = Date.now();
  if (!enabled()) { db.ai = { on: false }; return null; }
  const games = list.filter(t => t.cat === 'game' && t.live && t.current);
  const deals = games.filter(t => force || needsDeal(t, now)).slice(0, LIMITS.deals);
  const reviews = games.filter(t => force || needsReviews(t, now)).slice(0, LIMITS.reviews);
  const res = { ok: 0, failed: 0, error: null };
  const step = async (it, fn, what) => {
    try { await fn(it); res.ok++; return true; } catch (e) {
      res.failed++; res.error = e.message;
      log('warn', 'gemini', `${it.title}: ${what} · ${e.message}`);
      return !/Cuota|no es válida|Falta/.test(e.message); // sin cuota o sin clave no se sigue
    }
  };
  let go = true;
  for (const it of deals) {
    if (!(go = await step(it, analyzeDeal, 'Deal Index'))) break;
    log('ai', 'gemini', `${it.title}: Deal Index ${it.ai.score}/100 · ${it.ai.recomendacion.replace('_', ' ').toLowerCase()} (${Math.round(it.ai.confianza * 100)} %)`);
  }
  for (const it of go ? reviews : []) {
    if (!(go = await step(it, analyzeReviews, 'reseñas'))) break;
    log('ai', 'gemini', `${it.title}: resumen de reseñas (${it.reviews.ai.from})`);
  }
  db.ai = { on: true, model: modelName(), lastRun: now, ok: res.ok, failed: res.failed, error: res.error && !res.ok ? res.error : null };
  return res;
}
