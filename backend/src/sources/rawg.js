// RAWG (la misma base de datos de juegos que usa el Refugio 111): arte apaisado del juego para las
// tarjetas, además de géneros, fecha de salida y Metacritic para la ficha.
// Necesita una clave gratuita de rawg.io/apidocs en el secreto RAWG_API_KEY; sin ella no se busca nada.
import { score } from './keyshops.js';

const BASE = () => process.env.RAWG_API_BASE || 'https://api.rawg.io/api';
export const enabled = () => !!process.env.RAWG_API_KEY;

export async function info(title) {
  const r = await fetch(`${BASE()}/games?key=${encodeURIComponent(process.env.RAWG_API_KEY)}&search=${encodeURIComponent(title)}&page_size=8`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`RAWG respondió ${r.status}`);
  const hits = ((await r.json()).results || []).filter(g => g.background_image);
  // El mismo criterio que en las tiendas, sin plataforma: «FC 27» no vale para «FC 26» ni para un DLC.
  const best = hits.map(g => ({ g, s: score(g.name, title, null) })).filter(x => x.s !== null).sort((a, b) => b.s - a.s)[0]?.g;
  if (!best) return null;
  return {
    art: best.background_image,
    rawg: best.slug,
    genres: (best.genres || []).map(x => x.name).slice(0, 3).join(', ') || null,
    released: best.released || null,
    metacritic: best.metacritic || null
  };
}
