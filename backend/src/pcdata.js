// Modo mixto (GitHub + tu PC). Amazon, Fnac, El Corte Inglés y a veces la PS Store piden captcha a los servidores de GitHub,
// así que esas tres las revisa un runner de GitHub instalado en el PC de Javi, con la conexión de casa
// (workflow rastreo-pc.yml). El PC solo escribe pc.json en la rama «datos»; el ciclo de GitHub lo lee
// y usa esos precios mientras sean recientes. Si el PC lleva horas apagado, GitHub vuelve a probar él.
//   CG_MODO=nube  ciclo de GitHub: usa pc.json para esas tiendas si está al día
//   CG_MODO=pc    runner del PC: solo revisa esas tiendas y guarda pc.json
//   (sin CG_MODO) servidor local de siempre: revisa todas las tiendas
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export const PC_SHOPS = ['Amazon', 'Fnac', 'El Corte Inglés', 'PS Store'];
export const FRESH_MS = 3 * 60 * 60e3;
export const mode = () => (['nube', 'pc'].includes(process.env.CG_MODO) ? process.env.CG_MODO : '');

const FILE = () => path.join(config.dataDir, 'pc.json');
let data = null;

export function load() {
  try { data = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { data = null; }
  if (!data || typeof data.trackers !== 'object') data = { updated: 0, trackers: {} };
  return data;
}
const get = () => data || load();

// Precios que ha leído el PC para un tracker, solo si son recientes.
export function fresh(trackerId, now = Date.now()) {
  const e = get().trackers[trackerId];
  return e && now - e.t < FRESH_MS ? e.stores : null;
}

export function set(trackerId, stores) {
  get().trackers[trackerId] = { t: Date.now(), stores };
}

// Solo se guardan los trackers que siguen existiendo.
export function save(ids) {
  const d = get();
  d.trackers = Object.fromEntries(Object.entries(d.trackers).filter(([id]) => ids.includes(id)));
  d.updated = Date.now();
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(d, null, 1));
}
