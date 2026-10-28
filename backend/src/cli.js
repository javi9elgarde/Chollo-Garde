// CholloGarde en GitHub: GitHub Actions ejecuta este script cada hora (ciclo de precios) y cuando
// el panel publicado en GitHub Pages pide algo (crear, editar o borrar un tracker, probar alertas…).
// Lee y guarda los datos en DATA_DIR/db.json, que el workflow sube a la rama «datos».
//   node src/cli.js <accion> [json]     acciones: ciclo, crear, editar, borrar, escanear, probar
import * as store from './store.js';
import * as games from './games.js';
import * as actions from './actions.js';
import { engine } from './engine.js';
import { bus } from './bus.js';
import { dispatch, send, SAMPLE } from './notify/index.js';
import { close as closeBrowser } from './sources/browser.js';

const accion = process.argv[2] || 'ciclo';
let datos = {};
try { datos = JSON.parse(process.argv[3] || process.env.CG_DATOS || '{}') || {}; } catch { datos = {}; }

const newLogs = [];
bus.on('event', (type, data) => { if (type === 'log') newLogs.push(data); });

async function run() {
  const db = store.get();
  switch (accion) {
    case 'ciclo': {
      const r = await engine.cycle();
      return r ? `${r.ok} comprobados, ${r.failed} con error` : 'sin trackers';
    }
    case 'crear': {
      const { it, notify } = await actions.addTracker(datos);
      await notify();
      return { trackerId: it.id };
    }
    case 'editar': {
      const { it, rescan, notify } = actions.editTracker(datos.id, datos);
      if (rescan) await engine.cycle(it.id); else await notify();
      return { trackerId: it.id };
    }
    case 'borrar':
      actions.removeTracker(datos.id);
      return { trackerId: datos.id };
    case 'escanear':
      if (!actions.find(datos.id)) throw new actions.NotFound('Ese tracker no existe');
      await engine.cycle(datos.id);
      return { trackerId: datos.id };
    case 'probar': {
      const it = actions.find(datos.id) || db.trackers[0] || SAMPLE;
      const ch = datos.channel || 'all';
      if (ch === 'all') { await dispatch(it, { reason: 'test' }); return 'prueba enviada'; }
      const out = await send(it, { only: ch, test: true });
      if (out[ch] !== 'ok') throw new games.UserError(String(out[ch]).replace(/^error: /, ''));
      return 'prueba enviada';
    }
    default:
      throw new games.UserError(`Acción desconocida: ${accion}`);
  }
}

store.load();
const db = store.get();
db.trackers.forEach(games.migrate);
const t0 = Date.now();
let result, error = null;
try { result = await run(); } catch (e) { error = e.message; console.error(e); }

// Lo que el panel de GitHub necesita para mostrarse sin servidor.
const prevSources = new Map((db.sources || []).map(s => [s.name, s]));
db.sources = actions.sourceRows().map(s => (s.runs ? s : prevSources.get(s.name) || s));
db.logs = [...(db.logs || []), ...newLogs].slice(-300);
db.engine = { running: true, busy: false, intervalMin: 60, cycles: db.stats.cycles, requests: db.stats.requests, lastRun: Date.now(), lastAction: accion };
if (datos.reqId) {
  const entry = { id: String(datos.reqId).slice(0, 40), accion, ok: !error, error, at: Date.now(), secs: Math.round((Date.now() - t0) / 1000), ...(result && typeof result === 'object' ? result : { info: result }) };
  db.acciones = [entry, ...(db.acciones || [])].slice(0, 30);
}
db.version = 'github';
store.save({ now: true });
await closeBrowser();
console.log(error ? `Error: ${error}` : `Hecho: ${typeof result === 'object' ? JSON.stringify(result) : result}`);
// Un fallo del panel (juego no encontrado, duplicado…) no es un fallo del workflow: queda anotado en los datos.
process.exit(error && !datos.reqId ? 1 : 0);
