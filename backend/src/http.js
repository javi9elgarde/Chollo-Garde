// fetch con timeout, reintento ante 429/5xx y contador de peticiones.
import { get } from './store.js';

export class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status} en ${new URL(url).hostname}`); this.status = status; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Estadísticas por host para la tabla «Fuentes» del dashboard.
const hosts = new Map();
export function track(url, ok, ms) {
  const h = new URL(url).hostname;
  const s = hosts.get(h) || { host: h, runs: 0, fails: 0, lat: 0, last: 0, status: 'ok' };
  s.runs++; if (!ok) s.fails++;
  s.lat = s.lat ? Math.round(s.lat * 0.8 + ms * 0.2) : ms;
  s.last = Date.now(); s.status = ok ? 'ok' : 'warn';
  hosts.set(h, s);
}
export const hostStats = () => [...hosts.values()];

export async function getJson(url, { timeout = 15000, retries = 2, headers = {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    get().stats.requests++;
    let res;
    const t0 = Date.now();
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'CholloGarde/0.2 (rastreador personal)', Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      track(url, false, Date.now() - t0);
      if (attempt >= retries) throw new Error(`Sin respuesta de ${new URL(url).hostname}: ${e.message}`);
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    track(url, res.ok, Date.now() - t0);
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const wait = Math.min(30, +res.headers.get('retry-after') || 2 * 2 ** attempt) * 1000;
      await sleep(wait);
      continue;
    }
    throw new HttpError(res.status, url);
  }
}
