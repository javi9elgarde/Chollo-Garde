// IGDB, la misma fuente por defecto que el Refugio 111, a través de su proxy de Cloudflare (que guarda
// las claves de Twitch). No necesita ningún secreto aquí. Da arte apaisado, carátula, desarrolladora,
// géneros y fecha de salida. Si no encuentra el juego, games.addArt prueba con RAWG.
import { score } from './keyshops.js';

const BASE = () => process.env.IGDB_PROXY || 'https://refugio111-igdb.javi9play3.workers.dev';
export const enabled = () => BASE() !== 'off';

// Las imágenes de IGDB llevan el tamaño en la ruta: t_1080p es el arte grande para la tarjeta.
const big = u => (u ? u.replace(/\/t_[a-z0-9_]+\//, '/t_1080p/') : null);

export async function info(title) {
  const r = await fetch(`${BASE()}/search?q=${encodeURIComponent(title)}&limit=8`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`IGDB respondió ${r.status}`);
  const hits = (await r.json() || []).filter(g => g.image || g.cover);
  const best = hits.map(g => ({ g, s: score(g.name, title, null) })).filter(x => x.s !== null).sort((a, b) => b.s - a.s)[0]?.g;
  if (!best) return null;
  return {
    art: big(best.image || best.cover),
    cover: best.cover || null,
    igdb: best.id || null,
    genres: (best.genres || []).slice(0, 3).join(', ') || null,
    released: best.released || null,
    developer: best.developer || null
  };
}
