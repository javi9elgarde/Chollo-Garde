// Piezas sueltas: lectura de precios, elección de la ficha correcta y migración de trackers antiguos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, extract, blocked } from '../src/sources/web.js';
import { score } from '../src/sources/keyshops.js';
import { candidates, RETAIL } from '../src/sources/retail.js';
import { shopFor } from '../src/sources/shops.js';
import { migrate } from '../src/games.js';

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
