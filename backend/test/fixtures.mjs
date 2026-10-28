// Tiendas y APIs simuladas para las pruebas.
export const up = { steamEur: 29.5, eneba: 18.2, igDown: false, telegram: [], discord: [], hits: [] };

export const handler = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const p = u.pathname;
    if (p === '/steam/api/storesearch/') return json({ items: [{ type: 'app', id: 1145360, name: 'Hades' }, { type: 'app', id: 1145350, name: 'Hades II' }] });
    if (p === '/steam/api/appdetails') {
      const id = u.searchParams.get('appids');
      return json({ [id]: { success: true, data: { name: 'Hades II', header_image: 'https://cdn/h.jpg', is_free: false, genres: [{ description: 'Acción' }], metacritic: { score: 95 }, developers: ['Supergiant Games'], release_date: { date: '25 sep 2025' }, price_overview: { currency: 'EUR', initial: 2950, final: Math.round(up.steamEur * 100), discount_percent: 0 } } } });
    }
    if (p.startsWith('/steam/appreviews/')) return json({ success: 1, query_summary: { review_score_desc: 'Extremadamente positivas', total_positive: 96, total_negative: 4, total_reviews: 100 } });
    if (p === '/steam/saleaction/ajaxgetdeckappcompatibilityreport') return json({ results: { resolved_category: 3 } });
    if (p.startsWith('/tg/bot')) { up.telegram.push({ method: p.split('/').pop(), body: JSON.parse(body) }); return json({ ok: true }); }
    if (p === '/discord') { up.discord.push(JSON.parse(body)); res.writeHead(204); return res.end(); }
    json({ error: 'no mock ' + p }, 404);
  });
};

// Páginas de las tiendas tal y como las devolvería el navegador.
const ld = o => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
export const pages = url => {
  up.hits.push(url);
  if (url.includes('instant-gaming.com') && up.igDown) throw new Error('ECONNRESET');
  if (url.startsWith('https://www.instant-gaming.com/es/busquedas/')) {
    return `<div class="search listing-items">
      <div class="item"><a href="https://www.instant-gaming.com/es/5678-comprar-hades-ii-soundtrack-pc-steam/" title="Hades II - Soundtrack"></a><div class="price">4,99€</div></div>
      <div class="item"><a href="https://www.instant-gaming.com/es/1234-comprar-hades-ii-pc-juego-steam/" title="Hades II"></a><div class="price">19,49€</div></div>
      <div class="item"><a href="https://www.instant-gaming.com/es/9999-comprar-hades-ii-switch/" title="Hades II (Switch)"></a><div class="price">22,99€</div></div></div>`;
  }
  if (url === 'https://www.instant-gaming.com/es/1234-comprar-hades-ii-pc-juego-steam/') return '<meta property="og:title" content="Comprar Hades II PC Steam"><meta itemprop="price" content="19.49">';
  if (url.startsWith('https://www.eneba.com/es/store/all')) return `<a href="/es/steam-hades-ii-pc-steam-key-united-states">US</a><a href="/es/steam-hades-ii-pc-steam-key-global">Global</a><a href="/es/store/games">Juegos</a>`;
  if (url === 'https://www.eneba.com/es/steam-hades-ii-pc-steam-key-global') return `<title>Hades II</title>` + ld({ '@type': 'Product', name: 'Hades II (PC) Steam Key GLOBAL', offers: { '@type': 'AggregateOffer', lowPrice: up.eneba, priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } });
  if (url.startsWith('https://www.amazon.es/s?')) return `<div data-component-type="s-search-result"><a class="a-link-normal" href="/Funda-Hades-II/dp/B0FUNDAAAA/ref=sr_1_1"><h2><span>Funda para Hades II PC</span></h2></a></div>
    <div data-component-type="s-search-result"><a class="a-link-normal" href="/Hades-II-PS5/dp/B0PS5AAAAA/ref=sr_1_2"><h2><span>Hades II - PS5</span></h2></a></div>
    <div data-component-type="s-search-result"><a class="a-link-normal" href="/Hades-II-Pc/dp/B0PCAAAAAA/ref=sr_1_3"><h2><span>Hades II (PC)</span></h2></a><a href="/Hades-II-Pc/dp/B0PCAAAAAA/ref=sr_1_3?th=1">PC</a></div>`;
  if (url.startsWith('https://www.amazon.es/')) return `<span id="productTitle"> Hades II - PC </span><div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">24,95&nbsp;€</span></span></div><div id="availability"><span> En stock </span></div>`;
  if (url.startsWith('https://www.mediamarkt.es/es/search.html')) return `<a href="/es/product/_hades-ii-pc-1234567.html"><p>Hades II PC</p></a><a href="/es/category/videojuegos-pc-123.html">Videojuegos PC</a>`;
  if (url === 'https://www.mediamarkt.es/es/product/_hades-ii-pc-1234567.html') return ld({ '@type': 'Product', name: 'Hades II PC', offers: { '@type': 'Offer', price: 26.99, priceCurrency: 'EUR' } });
  if (url.startsWith('https://www.elcorteingles.es/search-nwx/')) return '<div class="no-results">No hemos encontrado resultados</div>';
  if (url.startsWith('https://www.game.es/resultados')) return `<a href="/hades-ii-pc-segunda-mano/231236">HADES II PC Segunda mano</a>
    <a href="/hades-ii-ps5/231235">HADES II PS5</a><a href="/hades-ii-pc/231234">HADES II PC</a><a href="/resultados?search=halloween">Halloween</a>`;
  if (url === 'https://www.game.es/hades-ii-pc/231234') return '<meta property="og:title" content="HADES II PC"><meta itemprop="price" content="29,95">';
  if (url.startsWith('https://impactgame.es/?s=')) return `<a href="https://impactgame.es/carrito">Carrito</a><a href="https://impactgame.es/categoria-producto/videojuegos/">Videojuegos</a><a href="https://impactgame.es/producto/hades-ii-pc/" title="Hades II PC"><img alt="Hades II PC"></a>`;
  if (url.startsWith('https://impactgame.es/')) return ld({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Product', name: 'Hades II PC', image: 'https://impactgame.es/h.jpg', offers: { '@type': 'Offer', price: '17.00', priceCurrency: 'EUR', availability: 'https://schema.org/OutOfStock' } }] });
  if (url.startsWith('https://www.fnac.es/')) return '<html><script src="https://ct.captcha-delivery.com/c.js"></script></html>';
  return null;
};

// Sirve las páginas simuladas en lugar de descargarlas o abrirlas con el navegador.
export const serve = async url => { const html = pages(url); return html === null ? { html: 'no', url, status: 404 } : { html, url, status: 200 }; };
