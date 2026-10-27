// Despacho real de alertas: Telegram (bot), Discord (webhook) y correo (SMTP).
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { get, save } from '../store.js';
import { log, emit } from '../bus.js';

const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const eur = v => EUR.format(v);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const refPrice = it => it.msrp || it.pvp || it.routeAvg || null;
function pastMin(it) {
  const p = it.history.slice(0, -1).map(h => h.p);
  if (it.atlEver) p.push(it.atlEver.p);
  return p.length ? Math.min(...p) : null;
}
export const isAtl = it => { const m = pastMin(it); return m !== null && it.current <= m; };

export function compose(it) {
  const best = (it.stores || [])[0] || {};
  const ref = refPrice(it);
  const disc = ref ? Math.round((1 - it.current / ref) * 100) : null;
  const atl = isAtl(it);
  const approx = best.approx ? '≈ ' : '';
  return {
    title: it.title,
    price: `${approx}${eur(it.current)}`,
    store: best.name || '—',
    discount: disc !== null && disc > 0 ? `−${disc} % vs precio oficial (${eur(ref)})` : null,
    target: eur(it.target),
    atl,
    url: best.url || it.url,
    image: it.image || null,
    note: best.approx ? 'Precio convertido de USD con el cambio del día; en la tienda puede variar unos céntimos.' : null
  };
}

// ---------- canales ----------
async function telegram(s, m, { test }) {
  if (!s.token || !s.chatId) throw new Error('falta el token del bot o el chat ID');
  const head = test ? '🧪 <b>Prueba de CholloGarde</b>\n' : '';
  const caption = `${head}🔥 <b>${esc(m.title)}</b>\n${esc(m.price)} en ${esc(m.store)}${m.discount ? `\n${esc(m.discount)}` : ''}\nTu objetivo: ${esc(m.target)}${m.atl ? '\n🏆 Mínimo histórico' : ''}`;
  const reply_markup = { inline_keyboard: [[{ text: '🛒 Comprar ahora', url: m.url }]] };
  const call = async (method, body) => {
    const r = await fetch(`${config.telegramBase}/bot${s.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || `HTTP ${r.status}`);
  };
  if (m.image) {
    try { return await call('sendPhoto', { chat_id: s.chatId, photo: m.image, caption, parse_mode: 'HTML', reply_markup }); } catch {}
  }
  await call('sendMessage', { chat_id: s.chatId, text: caption, parse_mode: 'HTML', reply_markup, disable_web_page_preview: true });
}

async function discord(s, m, { test }) {
  if (!s.url) throw new Error('falta la URL del webhook');
  const body = {
    username: 'CholloGarde',
    content: test ? '🧪 Prueba de CholloGarde' : null,
    embeds: [{
      title: m.title, url: m.url, color: 0xF2B544,
      description: `**${m.price}** en ${m.store}${m.discount ? `\n${m.discount}` : ''}${m.atl ? '\n🏆 **Mínimo histórico**' : ''}`,
      fields: [{ name: 'Tu objetivo', value: m.target, inline: true }],
      image: m.image ? { url: m.image } : undefined,
      footer: m.note ? { text: m.note } : undefined
    }]
  };
  const r = await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 404 ? ' (el webhook no existe)' : ''}`);
}

let mailer = { key: '', t: null };
async function email(s, m, { test }) {
  if (!s.user || !s.pass) throw new Error('falta el usuario o la contraseña SMTP');
  if (!s.to) throw new Error('falta el correo de destino');
  const key = [s.host, s.port, s.user, s.pass].join('|');
  if (mailer.key !== key) mailer = { key, t: nodemailer.createTransport({ host: s.host, port: +s.port, secure: +s.port === 465, auth: { user: s.user, pass: s.pass } }) };
  await mailer.t.sendMail({
    from: s.from || `CholloGarde <${s.user}>`,
    to: s.to,
    subject: `${test ? '[Prueba] ' : ''}🔥 ${m.title} a ${m.price} (objetivo ${m.target})`,
    text: `${m.title}\n${m.price} en ${m.store}\n${m.discount || ''}\nTu objetivo: ${m.target}${m.atl ? '\nMínimo histórico' : ''}\n\n${m.url}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px">${m.image ? `<img src="${esc(m.image)}" alt="" style="width:100%;border-radius:8px">` : ''}
      <h2 style="margin:12px 0 4px">${esc(m.title)}</h2>
      <p style="font-size:18px;margin:4px 0"><b>${esc(m.price)}</b> en ${esc(m.store)}</p>
      ${m.discount ? `<p style="margin:4px 0;color:#15803d">${esc(m.discount)}</p>` : ''}
      <p style="margin:4px 0">Tu objetivo: ${esc(m.target)}${m.atl ? ' · <b>🏆 Mínimo histórico</b>' : ''}</p>
      <p><a href="${esc(m.url)}" style="display:inline-block;background:#F2B544;color:#111;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Ver oferta</a></p>
      ${m.note ? `<p style="color:#666;font-size:12px">${esc(m.note)}</p>` : ''}</div>`
  });
}

const CHANNELS = { telegram, discord, email };
const LABEL = { telegram: 'Telegram', discord: 'Discord', email: 'Correo' };

// Envía por los canales activos (o por uno concreto) y devuelve el resultado de cada uno.
export async function send(it, { only = null, test = false } = {}) {
  const s = get().settings, m = compose(it), out = {};
  await Promise.all(Object.keys(CHANNELS).map(async ch => {
    if (only ? only !== ch : !s[ch].enabled) { out[ch] = 'off'; return; }
    try { await CHANNELS[ch](s[ch], m, { test }); out[ch] = 'ok'; log('ok', ch, `${LABEL[ch]} enviado · ${it.title}`); }
    catch (e) { out[ch] = 'error: ' + e.message; log('err', ch, `${LABEL[ch]} falló: ${e.message}`); }
  }));
  return out;
}

export async function dispatch(it, { reason = 'target' } = {}) {
  const db = get();
  log('ok', 'trigger', `Precio_Actual ${eur(it.current)} <= Precio_Objetivo ${eur(it.target)} · ${it.title}`);
  const channels = await send(it, { test: reason === 'test' });
  const al = { id: 'al-' + crypto.randomBytes(4).toString('hex'), itemId: it.id, title: it.title, cat: it.cat, t: Date.now(), price: it.current, target: it.target, atl: isAtl(it), reason, read: false, channels: { web: true, ...channels } };
  db.alerts.unshift(al);
  db.alerts = db.alerts.slice(0, 200);
  save();
  emit('alert', al);
  return al;
}

// Ejemplo para las pruebas cuando aún no hay trackers.
export const SAMPLE = { id: 'sample', cat: 'game', title: 'Hades II (ejemplo)', current: 23.79, target: 25, msrp: 29.5, history: [{ t: 0, p: 29.5 }, { t: 1, p: 23.79 }],
  image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145350/header.jpg', url: 'https://store.steampowered.com/app/1145350/', stores: [{ name: 'Steam', price: 23.79, url: 'https://store.steampowered.com/app/1145350/', approx: false }] };
