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
    case 'diagnostico':
      // Solo para depurar tiendas: abre cada dirección y escribe en el registro del workflow qué ha visto.
      await diagnose(datos);
      return 'diagnóstico en el registro del workflow';
    default:
      throw new games.UserError(`Acción desconocida: ${accion}`);
  }
}

async function diagnose({ urls = [], match = '', modes = ['fetch', 'headless'] }) {
  const re = match ? new RegExp(match, 'i') : null;
  for (const mode of modes) {
    if (mode === 'visible') { await closeBrowser(); process.env.BROWSER_VISIBLE = '1'; }
    for (const url of urls.slice(0, 20)) {
      let line = `[${mode}] ${url}\n`;
      try {
        const r = mode === 'fetch'
          ? await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept-Language': 'es-ES,es;q=0.9' }, redirect: 'follow' }).then(async x => ({ status: x.status, url: x.url, html: await x.text() }))
          : await (await import('./sources/browser.js')).render(url);
        const html = r.html || '';
        const links = [...new Set([...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]))];
        line += `  status ${r.status} · final ${r.url} · ${html.length} bytes · title «${(html.match(/<title[^>]*>([^<]*)/i)?.[1] || '').trim().slice(0, 100)}» · bloqueo ${(await import('./sources/web.js')).blocked(html, r.status)}\n`;
        for (const f of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
          const names = [...f[2].matchAll(/<input\b[^>]*name=["']([^"']+)/gi)].map(m => m[1]);
          if (names.length) line += `  form ${(f[1].match(/action=["']([^"']*)/i)?.[1] || '-')} [${names.join(',')}]\n`;
        }
        const web = await import('./sources/web.js'), ks = await import('./sources/keyshops.js');
        try { const x = web.extract(html, r.url); line += `  ficha: ${x.price} € «${x.title}» agotado=${x.out}\n`; } catch (e) { line += `  ficha: ${e.message}\n`; }
        const ld = [...html.matchAll(/application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1].match(/"@type"\s*:\s*"([^"]+)"/g)?.join(',')).join(' / ');
        line += `  ld+json: ${ld.slice(0, 300)}\n  precios: ${[...html.matchAll(/.{0,60}(?:"price"|itemprop="price"|"lowPrice"|"amount"|€).{0,60}/g)].slice(0, 6).map(m => m[0].replace(/\s+/g, ' ')).join(' ‖ ').slice(0, 900)}\n`;
        const wv = web.wooVariations(html); if (wv.length || /data-product_variations/.test(html)) line += `  variantes: ${JSON.stringify(wv).slice(0, 400)} · bruto: ${(html.match(/data-product_variations=.{0,300}/)?.[0] || '').replace(/\s+/g, ' ')}\n`;
        if (/instant-gaming/.test(url)) line += `  candidatos IG: ${ks.igCandidates(html).slice(0, 8).map(c => c.label).join(' | ')}\n`;
        if (/eneba/.test(url)) line += `  candidatos Eneba: ${ks.enebaCandidates(html).slice(0, 8).map(c => c.label).join(' | ')}\n`;
        line += `  ${links.length} enlaces; coinciden: ${(re ? links.filter(l => re.test(l)) : []).slice(0, 15).join(' | ')}\n`;
      } catch (e) { line += `  ERROR ${e.message.split('\n')[0]}\n`; }
      console.log(line);
    }
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
if (datos.reqId && accion !== 'diagnostico') {
  const entry = { id: String(datos.reqId).slice(0, 40), accion, ok: !error, error, at: Date.now(), secs: Math.round((Date.now() - t0) / 1000), ...(result && typeof result === 'object' ? result : { info: result }) };
  db.acciones = [entry, ...(db.acciones || [])].slice(0, 30);
}
db.version = 'github';
store.save({ now: true });
await closeBrowser();
console.log(error ? `Error: ${error}` : `Hecho: ${typeof result === 'object' ? JSON.stringify(result) : result}`);
// Un fallo del panel (juego no encontrado, duplicado…) no es un fallo del workflow: queda anotado en los datos.
process.exit(error && !datos.reqId ? 1 : 0);
