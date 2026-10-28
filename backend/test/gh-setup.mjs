// Se carga con `node --import` antes de src/cli.js: tiendas y Steam simulados, como en api.test.js.
import http from 'node:http';
import { handler, serve } from './fixtures.mjs';

const server = http.createServer(handler);
await new Promise(r => server.listen(0, '127.0.0.1', r));
server.unref();
const base = `http://127.0.0.1:${server.address().port}`;
Object.assign(process.env, { STEAM_STORE_BASE: base + '/steam', TELEGRAM_API_BASE: base + '/tg', DISCORD_WEBHOOK_URL: base + '/discord', RAWG_API_BASE: base + '/rawg', RAWG_API_KEY: 'prueba' });
const web = await import('../src/sources/web.js');
web._setFetchers({ fetch: serve, render: serve });
(await import('../src/sources/retail.js'))._setRetryMs(0);
