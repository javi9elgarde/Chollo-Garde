// Configuración del servidor: valores por defecto + backend/.env (si existe) + variables de entorno.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Lector mínimo de .env (CLAVE=valor, # comentarios). No pisa variables ya definidas.
function loadEnvFile(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(+v) ? +v : d);

export const config = {
  port: num(env.PORT, 8787),
  // 127.0.0.1 = solo accesible desde este PC. 0.0.0.0 lo abre a la red (pon DASHBOARD_PASSWORD).
  host: env.HOST || '127.0.0.1',
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  frontendDir: path.resolve(ROOT, env.FRONTEND_DIR || '../frontend'),
  password: env.DASHBOARD_PASSWORD || '',
  intervalMin: num(env.CHECK_INTERVAL_MIN, 60),
  openBrowser: env.OPEN_BROWSER === '1',
  // URLs base de las APIs externas (se pueden cambiar en los tests).
  cheapsharkBase: env.CHEAPSHARK_BASE || 'https://www.cheapshark.com/api/1.0',
  steamStoreBase: env.STEAM_STORE_BASE || 'https://store.steampowered.com',
  fxUrl: env.FX_URL || 'https://api.frankfurter.app/latest?from=USD&to=EUR',
  telegramBase: env.TELEGRAM_API_BASE || 'https://api.telegram.org',
  // Valores iniciales de los canales. Lo que guardes desde el dashboard tiene prioridad.
  telegram: { token: env.TELEGRAM_BOT_TOKEN || '', chatId: env.TELEGRAM_CHAT_ID || '' },
  discord: { url: env.DISCORD_WEBHOOK_URL || '' },
  smtp: {
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port: num(env.SMTP_PORT, 465),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || '',
    to: env.ALERT_EMAIL_TO || ''
  }
};
