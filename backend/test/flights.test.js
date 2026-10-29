// Vuelos: dirección de Google Flights, lectura de los resultados y tracker completo con una página de prueba.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-vuelos-'));
process.env.FLIGHTS_BROWSER = '0';
const gf = await import('../src/sources/flights.js');
const vuelos = await import('../src/vuelos.js');

// Descripciones copiadas de una búsqueda real hecha desde GitHub Actions (BCN → JFK, 28/10/2026).
const L1 = 'From 369 euros round trip total. Nonstop flight with Delta. Leaves Josep Tarradellas Barcelona-El Prat Airport at 10:35 AM on Thursday, January 14 and arrives at John F. Kennedy International Airport at 1:38 PM on Thursday, January 14. Total duration 9 hr 3 min. Select flight';
const L2 = 'From 393 euros round trip total. 1 stop flight with KLM. Leaves Josep Tarradellas Barcelona-El Prat Airport at 1:10 PM on Thursday, January 14 and arrives at John F. Kennedy International Airport at 7:20 PM on Thursday, January 14. Total duration 12 hr 10 min. Layover (1 of 1) is a 1 hr 30 min layover at Amsterdam Airport Schiphol in Amsterdam. Select flight';
const page = (labels, level = 'typical') => `<html><head><title>Barcelona to New York | Google Flights</title></head><body>
  <div role="heading">Prices are currently <span class="gOatQ T9AX1b">${level}</span></div>
  ${labels.map(l => `<div class="JMc5Xc" role="link" aria-label="${l}"></div><span aria-label="${l.match(/\d+/)[0]} euros" role="text">€${l.match(/\d+/)[0]}</span>`).join('\n')}
  ${labels.length ? `<div class="JMc5Xc" aria-label="${labels[0]}"></div>` : ''}</body></html>`;

test('la búsqueda se codifica como la de la web de Google Flights', () => {
  // Mismo «tfs» que se probó desde GitHub y devolvió resultados.
  assert.equal(gf.tfs({ legs: [{ date: '2026-12-04', from: 'MAD', to: 'BCN' }] }), 'CBwQAhoeEgoyMDI2LTEyLTA0agcIARIDTUFEcgcIARIDQkNOQgEBSAGYAQI=');
  assert.equal(gf.tfs({ legs: [{ date: '2027-01-14', from: 'BCN', to: 'JFK' }, { date: '2027-01-21', from: 'JFK', to: 'BCN' }] }), 'CBwQAhoeEgoyMDI3LTAxLTE0agcIARIDQkNOcgcIARIDSkZLGh4SCjIwMjctMDEtMjFqBwgBEgNKRktyBwgBEgNCQ05CAQFIAZgBAQ==');
  const u = gf.searchUrl({ origin: 'MAD', dest: 'BCN', depart: '2026-12-04', adults: 2, maxStops: 0 });
  assert.match(u, /hl=es&gl=ES&curr=EUR$/);
  const raw = Buffer.from(decodeURIComponent(u.match(/tfs=([^&]+)/)[1]), 'base64');
  assert.ok(raw.includes(Buffer.from([0x42, 0x02, 0x01, 0x01])), 'dos adultos');
  assert.ok(raw.includes(Buffer.from([0x28, 0x00])), 'sin escalas');
});

test('lee cada vuelo de su descripción', () => {
  const a = gf.parseLabel(L1), b = gf.parseLabel(L2);
  assert.deepEqual([a.price, a.stops, a.airline, a.depTime, a.arrTime, a.durMin], [369, 0, 'Delta', '10:35', '13:38', 543]);
  assert.deepEqual([b.price, b.stops, b.airline, b.via[0].city, b.via[0].min, b.durMin], [393, 1, 'KLM', 'Amsterdam', 90, 730]);
  assert.equal(gf.parseLabel('369 euros'), null);
  const c = gf.parseLabel('From 1,204 euros round trip total. 2 stops flight with Iberia and Qatar Airways. Leaves Madrid at 12:05 AM on Friday, March 12 and arrives at Haneda Airport at 6:55 PM on Saturday, March 13. Total duration 27 hr. Layover (1 of 2) is a 10 hr 5 min overnight layover at Hamad International Airport in Doha. Layover (2 of 2) is a 50 min layover at Narita International Airport in Tokyo. This price does not include overhead bin access. Select flight');
  assert.deepEqual([c.price, c.stops, c.airline, c.depTime, c.durMin, c.via.map(v => v.city).join(','), c.via[0].overnight, c.noCabinBag], [1204, 2, 'Iberia and Qatar Airways', '00:05', 1620, 'Doha,Tokyo', true, true]);
});

test('página de resultados: vuelos sin repetir, ordenados y nivel de precios', () => {
  const p = gf.parse(page([L2, L1], 'low'));
  assert.equal(p.flights.length, 2);
  assert.equal(p.flights[0].price, 369);
  assert.equal(p.level, 'low');
});

test('tracker de vuelo: fechas flexibles, mejor día, calendario y referencia de la ruta', async () => {
  const d0 = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  const seen = [];
  gf._setFetcher(async url => {
    const raw = Buffer.from(decodeURIComponent(url.match(/tfs=([^&]+)/)[1]), 'base64').toString('latin1');
    const date = raw.match(/\d{4}-\d{2}-\d{2}/)[0];
    seen.push(date);
    // El día siguiente al elegido es más barato.
    const cheap = date > d0;
    return { status: 200, url, html: page(cheap ? [L1.replace('369', '310'), L2] : [L1, L2]) };
  });
  const it = await vuelos.createTracker({ origin: 'bcn', dest: 'JFK', depart: d0, ret: new Date(Date.parse(d0) + 7 * 864e5).toISOString().slice(0, 10), trip: 'roundtrip', flex: 1, target: 300 });
  assert.equal(it.cat, 'flight');
  assert.equal(it.title, 'Barcelona → Nueva York');
  assert.equal(seen.length, 3);
  assert.equal(it.current, 310);
  assert.ok(it.bestDepart > d0);
  assert.equal(it.calendar.length, 3);
  assert.equal(it.calendar.find(c => c.depart === d0).price, 369);
  assert.equal(it.stores[0].name, 'Google Flights');
  assert.match(it.url, /google\.com\/travel\/flights\?tfs=/);
  assert.equal(it.priceLevel, 'typical');
  assert.equal(it.airline, 'Delta');
  // Siguiente ciclo: sube el precio y el histórico se queda con el mínimo del día.
  gf._setFetcher(async url => ({ status: 200, url, html: page([L1.replace('369', '420')]) }));
  const r = await vuelos.refresh(it);
  assert.equal(r.current, 420);
  assert.equal(it.history.length, 1);
  assert.equal(it.history[0].p, 310);
});

test('errores claros: aeropuertos, fechas y rutas sin vuelos', async () => {
  const d0 = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await assert.rejects(vuelos.createTracker({ origin: 'Madrid', dest: 'BCN', depart: d0, target: 50 }), /código de aeropuerto/);
  await assert.rejects(vuelos.createTracker({ origin: 'MAD', dest: 'BCN', depart: '2020-01-01', target: 50 }), /ya ha pasado/);
  gf._setFetcher(async url => ({ status: 200, url, html: page([]) }));
  await assert.rejects(vuelos.createTracker({ origin: 'MAD', dest: 'BCN', depart: d0, target: 50, maxStops: 0 }), /No hay vuelos de MAD a BCN.*sin escalas/);
  gf._setFetcher(async url => ({ status: 503, url, html: '' }));
  await assert.rejects(vuelos.createTracker({ origin: 'MAD', dest: 'BCN', depart: d0, target: 50 }), /Google Flights respondió 503/);
});

test('un vuelo que ya ha salido deja de rastrearse', async () => {
  const it = { id: 'f-x', cat: 'flight', live: true, title: 'Madrid → Lisboa', origin: 'MAD', dest: 'LIS', depart: '2020-01-01', current: 50, history: [] };
  await vuelos.refresh(it);
  assert.equal(it.expired, true);
});
