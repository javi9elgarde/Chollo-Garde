// Vertical de vuelos con precio real (Google Flights, ver sources/flights.js).
// Un tracker es una ruta con sus fechas: solo ida o ida y vuelta, escalas máximas, pasajeros y, si las fechas
// son flexibles, unos días antes y después (se mantiene la duración del viaje). En cada ciclo se busca cada
// fecha, el precio actual es el más barato de todas y se guarda el calendario con el precio de cada día.
import crypto from 'node:crypto';
import * as gf from './sources/flights.js';
import { UserError } from './games.js';
import { log } from './bus.js';

const DAY = 864e5;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dayKey = t => new Date(t).toLocaleDateString('sv-SE'); // AAAA-MM-DD en hora local
const today = () => dayKey(Date.now());
const shift = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Nombres en español de los aeropuertos más habituales; el resto se enseña con el nombre que da Google.
export const CITIES = {
  MAD: 'Madrid', BCN: 'Barcelona', VLC: 'Valencia', SVQ: 'Sevilla', AGP: 'Málaga', BIO: 'Bilbao', ALC: 'Alicante', PMI: 'Palma',
  IBZ: 'Ibiza', MAH: 'Menorca', TFN: 'Tenerife Norte', TFS: 'Tenerife Sur', LPA: 'Gran Canaria', ACE: 'Lanzarote', FUE: 'Fuerteventura',
  SCQ: 'Santiago', VGO: 'Vigo', LCG: 'A Coruña', OVD: 'Asturias', SDR: 'Santander', ZAZ: 'Zaragoza', GRX: 'Granada', XRY: 'Jerez',
  LEI: 'Almería', RMU: 'Murcia', REU: 'Reus', GRO: 'Girona', VIT: 'Vitoria', PNA: 'Pamplona', SLM: 'Salamanca', VLL: 'Valladolid',
  LIS: 'Lisboa', OPO: 'Oporto', FAO: 'Faro', LHR: 'Londres', LGW: 'Londres Gatwick', STN: 'Londres Stansted', CDG: 'París', ORY: 'París Orly',
  FCO: 'Roma', CIA: 'Roma Ciampino', MXP: 'Milán', BGY: 'Bérgamo', VCE: 'Venecia', NAP: 'Nápoles', AMS: 'Ámsterdam', BRU: 'Bruselas',
  BER: 'Berlín', MUC: 'Múnich', FRA: 'Fráncfort', DUB: 'Dublín', EDI: 'Edimburgo', ZRH: 'Zúrich', GVA: 'Ginebra', VIE: 'Viena',
  PRG: 'Praga', BUD: 'Budapest', WAW: 'Varsovia', KRK: 'Cracovia', CPH: 'Copenhague', OSL: 'Oslo', ARN: 'Estocolmo', HEL: 'Helsinki',
  ATH: 'Atenas', IST: 'Estambul', KEF: 'Reikiavik', RAK: 'Marrakech', CMN: 'Casablanca', JFK: 'Nueva York', EWR: 'Nueva York Newark',
  MIA: 'Miami', LAX: 'Los Ángeles', MEX: 'Ciudad de México', CUN: 'Cancún', BOG: 'Bogotá', LIM: 'Lima', EZE: 'Buenos Aires',
  GRU: 'São Paulo', HND: 'Tokio', NRT: 'Tokio Narita', BKK: 'Bangkok', DXB: 'Dubái', DOH: 'Doha', SIN: 'Singapur'
};
// Aerolíneas cuya tarifa más barata solo incluye un bolso pequeño (la maleta de mano y la facturada se pagan aparte).
const LOWCOST = /ryanair|vueling|easyjet|wizz|volotea|transavia|level|norwegian|eurowings|binter|jet2|pegasus|play\b|smartwings/i;

const city = (code, fallback) => CITIES[code] || fallback || code;

function cleanSpec(b = {}) {
  const code = v => String(v || '').trim().toUpperCase();
  const origin = code(b.origin), dest = code(b.dest);
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest)) throw new UserError('Escribe el origen y el destino con su código de aeropuerto de 3 letras (por ejemplo MAD o BCN).');
  if (origin === dest) throw new UserError('El origen y el destino tienen que ser distintos.');
  const depart = String(b.depart || '');
  if (!ISO.test(depart)) throw new UserError('Falta la fecha de ida.');
  if (depart < today()) throw new UserError('La fecha de ida ya ha pasado.');
  const trip = b.trip === 'oneway' || !b.ret ? 'oneway' : 'roundtrip';
  const ret = trip === 'roundtrip' ? String(b.ret) : null;
  if (ret && (!ISO.test(ret) || ret < depart)) throw new UserError('La vuelta tiene que ser el mismo día o después de la ida.');
  const ms = b.maxStops === '' || b.maxStops == null || +b.maxStops < 0 ? null : Math.min(2, Math.round(+b.maxStops));
  return {
    origin, dest, depart, ret, trip, maxStops: Number.isFinite(ms) ? ms : null,
    adults: Math.min(6, Math.max(1, Math.round(+b.adults || 1))),
    flex: Math.min(3, Math.max(0, Math.round(+b.flex || 0)))
  };
}

// Las fechas que se buscan: la elegida primero y luego las de alrededor (las que ya han pasado no).
function datePairs(spec) {
  const out = [], t = today();
  for (const n of [0, ...Array.from({ length: spec.flex }, (_, i) => [-(i + 1), i + 1]).flat()]) {
    const depart = shift(spec.depart, n);
    if (depart < t) continue;
    out.push({ depart, ret: spec.ret ? shift(spec.ret, n) : null, offset: n });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

const short = f => ({ price: f.price, airline: f.airline, stops: f.stops, via: f.via.map(v => v.city).join(', ') || null, durMin: f.durMin, depTime: f.depTime, arrTime: f.arrTime, ...(f.noCabinBag && { noCabinBag: true }) });

export async function quote(spec) {
  const calendar = [];
  let best = null, level = null, typical = null, options = [], names = {};
  for (const [i, d] of datePairs(spec).entries()) {
    if (i) await sleep(1500); // sin prisas: es una web gratuita
    const q = { ...spec, depart: d.depart, ret: d.ret };
    try {
      const r = await gf.search(q);
      const top = r.flights[0];
      calendar.push({ depart: d.depart, ret: d.ret, price: top?.price ?? null, airline: top?.airline || null, stops: top?.stops ?? null });
      if (d.offset === 0 || !level) { level = r.level || level; typical = r.typical || typical; }
      if (top && (!best || top.price < best.flight.price)) { best = { flight: top, depart: d.depart, ret: d.ret, url: r.url }; options = r.flights.slice(0, 6).map(short); }
      if (top && !names.from) names = { from: top.from, to: top.to };
    } catch (e) {
      calendar.push({ depart: d.depart, ret: d.ret, price: null, error: e.message });
    }
  }
  const failed = calendar.filter(c => c.error);
  if (!best) throw new UserError(failed.length ? `Google Flights: ${failed[0].error}` : `No hay vuelos de ${spec.origin} a ${spec.dest} para esas fechas${spec.maxStops === 0 ? ' sin escalas' : spec.maxStops != null ? ` con ${spec.maxStops} escala${spec.maxStops > 1 ? 's' : ''} como mucho` : ''}.`);
  return { best, calendar: calendar.sort((a, b) => a.depart.localeCompare(b.depart)), level, typical, options, names, failed };
}

// Precio, vuelo y detalles del mejor resultado dentro del tracker.
function apply(it, q) {
  const f = q.best.flight;
  Object.assign(it, {
    current: f.price, url: q.best.url,
    bestDepart: q.best.depart, bestRet: q.best.ret,
    airline: f.airline, stops: f.stops, via: f.via.map(v => v.city).join(', ') || null, durMin: f.durMin, depTime: f.depTime, arrTime: f.arrTime,
    baggage: { cabin: !f.noCabinBag, hold: null, holdFee: null, lowcost: LOWCOST.test(f.airline) },
    options: q.options, calendar: q.calendar, priceLevel: q.level, typical: q.typical,
    stores: [{ name: 'Google Flights', type: 'official', price: f.price, url: q.best.url, match: `${f.airline} · ${f.stops ? `${f.stops} escala${f.stops > 1 ? 's' : ''}` : 'directo'} · ${q.best.depart}` }]
  });
  // Precio de referencia: el rango habitual de Google para la ruta; si no lo da, la mediana del histórico propio.
  if (q.typical) it.routeAvg = Math.round((q.typical.lo + q.typical.hi) / 2);
  else {
    const p = (it.history || []).map(h => h.p).sort((a, b) => a - b);
    it.routeAvg = p.length >= 3 ? p[Math.floor(p.length / 2)] : it.routeAvg || f.price;
  }
}

export async function preview(body) {
  const spec = cleanSpec(body);
  const q = await quote(spec);
  return { cat: 'flight', live: true, spec, price: q.best.flight.price, best: q.best, calendar: q.calendar, level: q.level, typical: q.typical, options: q.options };
}

export async function createTracker(body) {
  if (!(+body.target > 0)) throw new UserError('Indica un precio objetivo mayor que 0.');
  const spec = cleanSpec(body);
  const q = await quote(spec);
  const now = Date.now();
  const it = {
    id: 'f-' + crypto.randomBytes(4).toString('hex'),
    cat: 'flight', live: true, source: 'Google Flights',
    title: `${city(spec.origin)} → ${city(spec.dest)}`,
    ...spec,
    target: Math.round(+body.target), alert: body.alert !== false, alerted: false,
    createdAt: now, lastCheck: now, lastError: null,
    history: [{ t: now, p: q.best.flight.price }],
    coupons: [],
    reviews: { rating: null, n: 0, src: 'sin reseñas', pros: [], cons: [] }
  };
  apply(it, q);
  return it;
}

// Un ciclo de rastreo: vuelve a buscar todas las fechas y guarda el precio más bajo del día en el histórico.
export async function refresh(it) {
  const old = it.current, now = Date.now();
  if (it.depart < today()) {
    it.expired = true; it.lastCheck = now; it.lastError = null;
    log('info', 'vuelos', `${it.title}: el vuelo del ${it.depart} ya ha salido; deja de rastrearse`);
    return { old, current: old, best: it.stores?.[0] || { name: 'Google Flights' }, failed: [] };
  }
  const q = await quote(cleanSpec(it)).catch(e => { it.lastCheck = now; throw e; });
  apply(it, q);
  const last = it.history.at(-1);
  if (last && dayKey(last.t) === dayKey(now)) { last.t = now; last.p = Math.min(last.p, it.current); }
  else it.history.push({ t: now, p: it.current });
  if (it.history.length > 365) it.history = it.history.slice(-365);
  it.lastCheck = now;
  it.lastError = q.failed.length ? q.failed.map(c => `${c.depart}: ${c.error}`).join(' · ') : null;
  for (const c of q.calendar) log(c.error ? 'warn' : 'info', 'Google Flights', `${it.origin}→${it.dest} ${c.depart}${c.ret ? '/' + c.ret : ''}: ${c.error || (c.price ? `${c.price} € · ${c.airline}` : 'sin vuelos')}`);
  return { old, current: it.current, best: it.stores[0], failed: q.failed };
}

// Cambios desde el panel que obligan a volver a buscar (fechas, escalas, pasajeros o flexibilidad).
export function updateSpec(it, b) {
  const keys = ['depart', 'ret', 'trip', 'maxStops', 'adults', 'flex'];
  if (!keys.some(k => b[k] !== undefined)) return false;
  const spec = cleanSpec({ ...it, ...Object.fromEntries(keys.filter(k => b[k] !== undefined).map(k => [k, b[k]])) });
  const datesChanged = spec.depart !== it.depart || spec.ret !== it.ret;
  Object.assign(it, spec);
  // Otras fechas son otro viaje: el histórico y el aviso empiezan de cero.
  if (datesChanged) { it.history = []; it.alerted = false; delete it.expired; }
  return true;
}
