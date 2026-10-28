// Piezas sueltas: lectura de precios, elección de la ficha correcta y migración de trackers antiguos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, extract, blocked } from '../src/sources/web.js';
import { score, pick } from '../src/sources/keyshops.js';
import { candidates, RETAIL } from '../src/sources/retail.js';
import { shopFor } from '../src/sources/shops.js';
import { migrate, addArt, updateSources } from '../src/games.js';
import http from 'node:http';
import { handler, up } from './fixtures.mjs';

test('precios en formato español e inglés', () => {
  assert.equal(parsePrice('59,99 €'), 59.99);
  assert.equal(parsePrice('1.299,00 €'), 1299);
  assert.equal(parsePrice('1,299.00'), 1299);
  assert.equal(parsePrice('59.99'), 59.99);
  assert.equal(parsePrice('1.299'), 1299);
  assert.equal(parsePrice(0), null);
  assert.equal(parsePrice('gratis'), null);
});

test('metaetiquetas y monedas que no son euros', () => {
  assert.equal(extract('<meta property="product:price:amount" content="39,95"><meta property="og:title" content="Zelda">', 'https://www.game.es/x').price, 39.95);
  assert.throws(() => extract('<meta property="product:price:amount" content="39.95"><meta property="product:price:currency" content="USD">', 'https://x.com/a'), /precio/);
  assert.equal(blocked('<title>Just a moment...</title>'), true);
  assert.equal(blocked('<html>ok</html>', 503), true);
});

test('elegir la ficha correcta en tiendas de keys', () => {
  assert.equal(score('EA Sports FC 26 PS5', 'EA Sports FC 26', 'PS5') > 0, true);
  assert.equal(score('EA Sports FC 26 PS4', 'EA Sports FC 26', 'PS5'), null);
  assert.equal(score('EA Sports FC 26 Points 1050 PS5', 'EA Sports FC 26', 'PS5'), null);
  assert.equal(score('Elden Ring PC Steam Key ARGENTINA', 'Elden Ring', 'PC'), null);
  assert.ok(score('Elden Ring PC Steam Key EUROPE', 'Elden Ring', 'PC') > score('Elden Ring Deluxe Edition PC Steam', 'Elden Ring', 'PC'));
});

test('versiones en tiendas generalistas', () => {
  assert.equal(score('Mario Kart World Nintendo Switch 2', 'Mario Kart World', 'Switch'), null);
  assert.ok(score('Mario Kart World Nintendo Switch 2', 'Mario Kart World', 'Switch 2') > 0);
  assert.ok(score('Zelda Tears of the Kingdom Nintendo Switch', 'Zelda Tears of the Kingdom', 'Switch') > 0);
  assert.equal(score('Hades II PS5 segunda mano', 'Hades II', 'PS5', { retail: true }), null);
  assert.equal(score('Mando DualSense Hades II PS5', 'Hades II', 'PS5', { retail: true }), null);
  assert.ok(score('Hades II PlayStation®5', 'Hades II', 'PS5', { retail: true }) > score('Hades II Edición Coleccionista PlayStation 5', 'Hades II', 'PS5', { retail: true }));
  const c = candidates('<a href="/es/product/_hades-ii-ps5-1.html"><span>Hades II</span></a><a href="/es/product/_hades-ii-ps5-1.html">PS5</a><a href="https://otra.com/es/product/_x-2.html">x</a>', 'https://www.mediamarkt.es/es/search.html?query=hades', RETAIL.MediaMarkt);
  assert.equal(c.length, 1);
  assert.ok(score(c[0].label, 'Hades II', 'PS5') > 0);
});

test('lo que se ha visto en las tiendas reales (octubre 2026)', () => {
  // «FC27» pegado en El Corte Inglés e Impact, «FC™ 27» en MediaMarkt.
  assert.ok(score('ea sports fc27 playstation 5', 'EA Sports FC 27', 'PS5', { retail: true }) !== null);
  assert.ok(score('PS5 EA SPORTS FC™ 27', 'EA Sports FC 27', 'PS5', { retail: true }) !== null);
  assert.ok(score('EA Sports FC 27 PS5', 'EA FC27', 'PS5') !== null);
  assert.equal(score('ea sports fc27 nintendo switch 2', 'EA Sports FC 27', 'PS5'), null);
  assert.equal(score('EA Sports FC 26 PS5', 'EA Sports FC 27', 'PS5'), null);
  // Eneba solo tenía la Ultimate para PS5: no cuenta como la estándar, salvo que se pida.
  assert.equal(score('psn ea sports fc 27 ultimate edition ps5 psn key europe', 'EA Sports FC 27', 'PS5'), null);
  assert.ok(score('psn ea sports fc 27 ultimate edition ps5 psn key europe', 'EA Sports FC 27 Ultimate', 'PS5') !== null);
  // MediaMarkt: la oferta está en un JSON-LD que no se puede leer entero; la primera oferta con precio vale.
  const mm = '<script type="application/ld+json">{"@type":"ProductGroup",roto}</script><script>{"offers":{"@type":"Offer","priceCurrency":"EUR","price":69.99,"availability":"https://schema.org/InStock"}},{"@type":"Offer","name":"Retirada del antiguo","priceCurrency":"EUR","price":0}</script>';
  assert.equal(extract(mm, 'https://www.mediamarkt.es/es/product/_ps5-x-1.html').price, 69.99);
  // Impact (WooCommerce): un producto con una variante por plataforma; el enlace elige la de PS5.
  const vars = JSON.stringify([{ attributes: { attribute_pa_plataforma: 'xbox-series-x' }, display_price: 54.95, is_in_stock: true }, { attributes: { attribute_pa_plataforma: 'ps5' }, display_price: 72.9, is_in_stock: false }]).replace(/"/g, '&quot;');
  const woo = `<form class="variations_form" data-product_variations="${vars}"></form><script type="application/ld+json">{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"54.95","priceCurrency":"EUR"}}</script>`;
  assert.deepEqual([extract(woo, 'https://impactgame.es/producto/fc27/?attribute_pa_plataforma=ps5').price, extract(woo, 'https://impactgame.es/producto/fc27/?attribute_pa_plataforma=ps5').out], [72.9, true]);
  assert.equal(extract(woo, 'https://impactgame.es/producto/fc27/').price, 54.95);
});

test('tiendas conocidas y desconocidas', () => {
  assert.deepEqual(shopFor('https://www.mediamarkt.es/es/product/_x.html'), { name: 'MediaMarkt', type: 'retail', browser: true });
  assert.equal(shopFor('https://www.tiendapequena.es/juego').name, 'tiendapequena.es');
});

test('los trackers de la versión anterior pasan a las tiendas nuevas', () => {
  const it = { cat: 'game', live: true, gameID: '612', title: 'Hades II', stores: [{ name: 'Fanatical', price: 18, approx: true }, { name: 'Steam', price: 29.5 }] };
  assert.equal(migrate(it), true);
  assert.equal(it.kind, 'multi');
  assert.equal(it.shops.length, 8);
  assert.deepEqual(it.stores.map(s => s.name), ['Steam']);
  assert.equal(migrate(it), false);
  const v3 = { cat: 'game', live: true, kind: 'multi', keys: false, links: [], stores: [] };
  migrate(v3);
  assert.deepEqual(v3.shops, ['Amazon', 'MediaMarkt', 'Fnac', 'El Corte Inglés', 'GAME', 'Impact']);
});

test('posesivos («Marvel\'s») y precio en priceSpecification (WooCommerce)', () => {
  const q = "Marvel's Wolverine";
  assert.ok(score('Marvel Wolverine Lobezno PS5', q, 'PS5', { retail: true }) !== null, 'Impact lo llama «Marvel Wolverine»');
  assert.ok(score('MARVELS WOLVERINE PS5', q, 'PS5', { retail: true }) !== null);
  assert.ok(score('Marvel’s Wolverine (PS5) PSN Key EUROPE', q, 'PS5') !== null);
  assert.equal(score('Mando PS5 DualSense Marvels Wolverine', q, 'PS5', { retail: true }), null, 'accesorio');
  assert.equal(score("Marvel's Spider-Man 2 PS5", q, 'PS5', { retail: true }), null);
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Marvel Wolverine Lobezno PS5', offers: [{ '@type': 'Offer', availability: 'https://schema.org/PreOrder', priceSpecification: [{ '@type': 'UnitPriceSpecification', price: '74.90', priceCurrency: 'EUR' }] }] })}</script>`;
  assert.equal(extract(html, 'https://impactgame.es/producto/reserva-marvel-wolverine-lobezno-ps5/').price, 74.9);
});

test('GAME: resultados en la lista JSON-LD y nombres en castellano («Lobezno»)', async () => {
  const { itemList } = await import('../src/sources/retail.js');
  const { pick } = await import('../src/sources/keyshops.js');
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'CollectionPage', mainEntity: { '@type': 'ItemList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Mando Inalámbrico DualSense Edición Limitada Lobezno', url: 'https://www.game.es/mando-inalambrico-dualsense-edicion-limitada-lobezno/267017' },
    { '@type': 'ListItem', position: 2, name: 'Marvel: Lobezno PS5', url: 'https://www.game.es/marvel-lobezno-ps5/266999' }] } })}</script>`;
  const cands = itemList(html, 'https://www.game.es/resultados?search=x', RETAIL.GAME);
  assert.equal(cands.length, 2);
  assert.equal(pick(cands, "Marvel's Wolverine", 'PS5', { retail: true }).url, 'https://www.game.es/marvel-lobezno-ps5/266999');
});

test('arte: IGDB primero y RAWG si IGDB falla', async () => {
  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, { IGDB_PROXY: base + '/igdb', RAWG_API_BASE: base + '/rawg', RAWG_API_KEY: 'prueba' });
  try {
    const a = { title: 'Hades II' };
    await addArt(a);
    assert.equal(a.art, 'https://images.igdb.com/igdb/image/upload/t_1080p/h2.jpg');
    up.igdbDown = true;
    const b = { title: 'Hades II' };
    await addArt(b);
    assert.equal(b.art, 'https://media.rawg/hades2.jpg');
    assert.equal(b.rawg, 'hades-2');
  } finally { up.igdbDown = false; server.close(); }
});

test('palabras clave: «Vol.» y «Volume», números romanos y nombres incompletos', () => {
  const t = 'Metal Gear Solid Master Collection Vol. 2';
  assert.ok(score('PS5 Metal Gear Solid: Master Collection Volume 2', t, 'PS5', { retail: true }) > 90, 'MediaMarkt escribe «Volume»');
  assert.equal(score('Metal Gear Solid Master Collection Vol. 1 - PS5', t, 'PS5'), null, 'otro número nunca vale');
  assert.ok(score('Hades 2 PC', 'Hades II', 'PC') > 90);
  // Falta «Master»: no vale de primeras, sí como búsqueda por palabras clave (y entonces es dudoso).
  assert.equal(score('Metal Gear Solid Collection Vol 2 PS5', t, 'PS5'), null);
  assert.ok(score('Metal Gear Solid Collection Vol 2 PS5', t, 'PS5', { loose: true }) > 0);
  assert.equal(score('Metal Gear Solid Delta PS5', t, 'PS5', { loose: true }), null, 'faltan demasiadas palabras');
});

test('varios productos parecidos: dudoso con opciones; los descartados no vuelven', () => {
  const t = 'Metal Gear Solid Master Collection Vol. 2';
  const c = (url, label, price) => ({ url, label, title: label, price });
  const one = pick([c('a', 'Metal Gear Solid Master Collection Vol. 2 PS5'), c('b', 'Metal Gear Solid Master Collection Vol. 2 Day One Edition PS5 + Steelbook + Póster')], t, 'PS5');
  assert.equal(one.url, 'a');
  assert.equal(one.doubt, false, 'la otra se parece mucho menos: no pregunta');
  const two = pick([c('a', 'Metal Gear Solid Master Collection Vol. 2 PS5', 49.99), c('b', 'Metal Gear Solid Master Collection Vol. 2 Day One PS5', 54.99)], t, 'PS5');
  assert.equal(two.doubt, true);
  assert.deepEqual(two.options.map(o => [o.url, o.price]), [['a', 49.99], ['b', 54.99]]);
  const loose = pick([c('z', 'Metal Gear Solid Collection Vol 2 PS5')], t, 'PS5');
  assert.equal(loose.doubt, true, 'encontrado solo por palabras clave');
  assert.equal(pick([c('a', 'Metal Gear Solid Master Collection Vol. 2 PS5')], t, 'PS5', { reject: ['a'] }), null);
});

test('stock: reserva y agotado', () => {
  const pre = extract(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Marvel Lobezno PS5', offers: { '@type': 'Offer', price: 74.9, priceCurrency: 'EUR', availability: 'https://schema.org/PreOrder' } })}</script>`, 'https://www.game.es/marvel-lobezno-ps5/253892');
  assert.equal(pre.pre, true);
  assert.equal(pre.out, false);
  assert.equal(extract('<meta property="og:title" content="Reserva Marvel Wolverine PS5"><meta itemprop="price" content="74,90">', 'https://impactgame.es/producto/x/').pre, true);
});

test('«Ninguno es»: se guardan los descartes y se olvida esa ficha', () => {
  const it = { cat: 'game', live: true, kind: 'multi', shops: ['MediaMarkt', 'GAME'], links: [], stores: [
    { name: 'MediaMarkt', auto: true, url: 'https://www.mediamarkt.es/es/product/_mal-1.html', doubt: true },
    { name: 'GAME', auto: true, url: 'https://www.game.es/x/1', price: 50 }] };
  updateSources(it, { reject: { MediaMarkt: ['https://www.mediamarkt.es/es/product/_mal-1.html', 'https://www.mediamarkt.es/es/product/_mal-2.html'], Inventada: ['https://x.es/'] } });
  assert.deepEqual(Object.keys(it.reject), ['MediaMarkt']);
  assert.equal(it.reject.MediaMarkt.length, 2);
  assert.deepEqual(it.stores.map(s => s.name), ['GAME']);
});

test('un pack con otro número no vale («Vol. 1 + Vol. 2» al buscar el Vol. 2)', () => {
  const t = 'Metal Gear Solid Master Collection Vol. 2';
  assert.equal(score('Metal Gear Solid Master Collection Vol. 1 - PS5+Metal Gear Solid: Master Collection Volume 2 – Day One Edition - PS5', t, 'PS5', { retail: true }), null);
  assert.ok(score('Metal Gear Solid: Master Collection Volume 2 – Day One Edition - PS5', t, 'PS5', { retail: true }) > 0);
  assert.equal(score('EA SPORTS FC 26 + FC 27 PS5', 'EA Sports FC 27', 'PS5'), null);
  assert.ok(score('EA Sports FC27 PlayStation 5', 'EA Sports FC 27', 'PS5') > 0);
});

test('PS Store: ficha de PS5 (no la de PS4 ni la banda sonora), precio actual y de lanzamiento', async () => {
  const web = await import('../src/sources/web.js');
  const { serve } = await import('./fixtures.mjs');
  web._setFetchers({ fetch: serve, render: serve });
  const ps = await import('../src/sources/psstore.js');
  const r = await ps.find('Hades II', 'PS5');
  assert.equal(r.url, 'https://store.playstation.com/es-es/product/EP0001-PPSA01234_00-HADES2000000000');
  assert.equal(r.type, 'official');
  assert.equal(r.price, 23.99);
  assert.equal(r.initial, 29.99, 'precio base, sin la rebaja');
  assert.equal(ps.covers('PC'), false);
});

test('bloqueos: «Access Denied» dentro de una ficha grande no es un bloqueo', () => {
  assert.equal(blocked('<html><title>Access Denied</title><h1>Access Denied</h1>Reference #18.30c83017</html>'), true);
  assert.equal(blocked('<html>' + 'x'.repeat(30000) + '<svg><title>Access Denied</title></svg><script type="application/ld+json">{}</script></html>'), false);
});
