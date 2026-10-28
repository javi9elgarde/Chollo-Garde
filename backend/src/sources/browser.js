// Navegador real para las tiendas con protección anti-bots (Amazon, MediaMarkt, Fnac, El Corte Inglés, Eneba…).
// Usa el Edge o el Chrome que ya tienes instalado (no descarga nada) con un perfil propio en data/navegador,
// así las cookies se conservan entre ciclos como haría una persona. Se cierra solo tras un rato sin uso.
import path from 'node:path';
import { config } from '../config.js';

let ctxPromise = null, idle = null, active = 0;
const waiting = [];
const MAX_TABS = 3;
const CHANNELS = (process.env.BROWSER_CHANNEL || 'msedge,chrome').split(',').map(s => s.trim()).filter(Boolean);

async function context() {
  if (ctxPromise) return ctxPromise;
  ctxPromise = (async () => {
    let pw;
    try { pw = await import('playwright-core'); } catch { throw new Error('falta playwright-core: ejecuta windows\\instalar.bat otra vez'); }
    const dir = path.join(config.dataDir, 'navegador');
    let lastErr;
    for (const channel of CHANNELS) {
      try {
        return await pw.chromium.launchPersistentContext(dir, {
          channel, headless: process.env.BROWSER_VISIBLE !== '1', locale: 'es-ES', timezoneId: 'Europe/Madrid',
          viewport: { width: 1366, height: 900 }, args: ['--disable-blink-features=AutomationControlled']
        });
      } catch (e) { lastErr = e; }
    }
    throw new Error(`no encuentro Edge ni Chrome para abrir las tiendas protegidas (${String(lastErr?.message || '').split('\n')[0]})`);
  })();
  ctxPromise.catch(() => { ctxPromise = null; });
  return ctxPromise;
}

function scheduleClose() {
  clearTimeout(idle);
  idle = setTimeout(async () => {
    const p = ctxPromise; ctxPromise = null;
    try { (await p)?.close(); } catch {}
  }, 90e3);
}

// Como mucho 3 pestañas a la vez, para no cargar el PC ni las tiendas.
async function slot(fn) {
  if (active >= MAX_TABS) await new Promise(r => waiting.push(r)); else active++;
  // Al terminar, la pestaña pasa directamente al siguiente en la cola.
  try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
}

// Abre la página, espera a que cargue el precio y devuelve el HTML.
export function render(url, { waitFor = null, timeout = 30000 } = {}) {
  return slot(async () => {
    clearTimeout(idle);
    const ctx = await context();
    const page = await ctx.newPage();
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
      if (waitFor) { try { await page.waitForSelector(waitFor, { timeout: 6000 }); } catch {} }
      return { html: await page.content(), url: page.url(), status: res ? res.status() : 0 };
    } finally {
      await page.close().catch(() => {});
      scheduleClose();
    }
  });
}

export async function close() { clearTimeout(idle); const p = ctxPromise; ctxPromise = null; try { (await p)?.close(); } catch {} }
