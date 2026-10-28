// Base de datos local en un fichero JSON (data/db.json).
// Para decenas o cientos de trackers es más que suficiente y no necesita instalar nada.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FILE = () => path.join(config.dataDir, 'db.json');

function defaultSettings() {
  const c = config;
  return {
    telegram: { enabled: !!(c.telegram.token && c.telegram.chatId), token: c.telegram.token, chatId: c.telegram.chatId },
    discord: { enabled: !!c.discord.url, url: c.discord.url },
    email: { enabled: !!(c.smtp.user && c.smtp.pass), to: c.smtp.to || c.smtp.user, host: c.smtp.host, port: c.smtp.port, user: c.smtp.user, pass: c.smtp.pass, from: c.smtp.from },
    sound: true,
    engine: true,
    intervalMin: c.intervalMin
  };
}

let db = null;

export function load() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') {
      // Fichero dañado: se guarda una copia y se empieza de cero en vez de no arrancar.
      try { fs.copyFileSync(FILE(), FILE() + '.corrupto-' + Date.now()); } catch {}
    }
  }
  const d = defaultSettings();
  // Con datos públicos (GitHub), los canales salen siempre de los secretos, nunca del fichero.
  const s = config.publicData ? { sound: raw?.settings?.sound } : raw?.settings || {};
  db = {
    trackers: raw?.trackers || [],
    alerts: raw?.alerts || [],
    settings: {
      ...d, ...s,
      telegram: { ...d.telegram, ...s.telegram },
      discord: { ...d.discord, ...s.discord },
      email: { ...d.email, ...s.email }
    },
    stats: { cycles: 0, requests: 0, ...raw?.stats }
  };
  // Lo que solo usa la versión de GitHub (registro, peticiones del panel…) se conserva tal cual.
  for (const k of ['logs', 'acciones', 'sources', 'engine', 'version']) if (raw?.[k] !== undefined) db[k] = raw[k];
  return db;
}

export const get = () => db || load();

let timer = null;
export function save({ now = false } = {}) {
  clearTimeout(timer);
  const write = () => {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = FILE() + '.tmp';
    const out = config.publicData ? { ...db, settings: publicDataSettings() } : db;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 1));
    fs.renameSync(tmp, FILE());
  };
  if (now) write(); else timer = setTimeout(write, 300);
}

// Secretos que nunca salen del servidor: el dashboard solo sabe si están configurados.
// Ajustes que se pueden publicar: solo si cada canal está configurado, sin claves, chat ni correo.
function publicDataSettings() {
  const s = db.settings;
  return { canales: { telegram: !!s.telegram.enabled, discord: !!s.discord.enabled, email: !!s.email.enabled }, sound: s.sound, engine: true, intervalMin: 60 };
}

export function publicSettings() {
  const s = get().settings;
  return {
    telegram: { enabled: s.telegram.enabled, chatId: s.telegram.chatId, tokenSet: !!s.telegram.token },
    discord: { enabled: s.discord.enabled, urlSet: !!s.discord.url },
    email: { enabled: s.email.enabled, to: s.email.to, host: s.email.host, port: s.email.port, user: s.email.user, from: s.email.from, passSet: !!s.email.pass },
    sound: s.sound,
    engine: s.engine,
    intervalMin: s.intervalMin,
    ai: { on: !!config.gemini.key, model: db.ai?.model || config.gemini.model || null }
  };
}

// Aplica cambios del dashboard. Un secreto vacío significa «no lo cambies».
export function updateSettings(p = {}) {
  const s = get().settings;
  const keep = (v, old) => (typeof v === 'string' && v.trim() ? v.trim() : old);
  if (p.telegram) s.telegram = { enabled: !!p.telegram.enabled, chatId: (p.telegram.chatId ?? s.telegram.chatId).trim(), token: keep(p.telegram.token, s.telegram.token) };
  if (p.discord) s.discord = { enabled: !!p.discord.enabled, url: keep(p.discord.url, s.discord.url) };
  if (p.email) {
    const e = p.email;
    s.email = { ...s.email, enabled: !!e.enabled, to: (e.to ?? s.email.to).trim(), user: (e.user ?? s.email.user).trim(), from: (e.from ?? s.email.from).trim(),
      host: (e.host ?? s.email.host).trim() || 'smtp.gmail.com', port: +e.port || s.email.port, pass: keep(e.pass, s.email.pass) };
  }
  if (typeof p.sound === 'boolean') s.sound = p.sound;
  if (typeof p.engine === 'boolean') s.engine = p.engine;
  if (p.intervalMin !== undefined) s.intervalMin = Math.min(1440, Math.max(5, Math.round(+p.intervalMin) || s.intervalMin));
  // Borrar un secreto de forma explícita.
  for (const k of p.clear || []) {
    if (k === 'telegram.token') s.telegram.token = '';
    if (k === 'discord.url') s.discord.url = '';
    if (k === 'email.pass') s.email.pass = '';
  }
  save();
  return publicSettings();
}
