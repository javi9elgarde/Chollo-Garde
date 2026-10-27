// Cambio USD → EUR (tipos del BCE vía frankfurter.app). CheapShark solo da precios en dólares.
import { config } from '../config.js';
import { getJson } from '../http.js';

const FALLBACK = 0.92;
let cache = { rate: null, at: 0 };

export async function usdToEur() {
  if (cache.rate && Date.now() - cache.at < 12 * 3600e3) return cache.rate;
  try {
    const r = await getJson(config.fxUrl, { retries: 1 });
    const rate = r?.rates?.EUR;
    if (rate > 0.5 && rate < 1.5) cache = { rate, at: Date.now() };
  } catch {}
  return cache.rate || FALLBACK;
}
export const _resetFx = () => { cache = { rate: null, at: 0 }; };
