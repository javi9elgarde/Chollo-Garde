// Versión de GitHub: el script que ejecuta GitHub Actions guarda datos publicables (sin claves).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-gh-'));
const env = { ...process.env, DATA_DIR: tmp, CG_PUBLIC_DATA: '1', TELEGRAM_BOT_TOKEN: 'secreto-123', TELEGRAM_CHAT_ID: '42', SMTP_USER: '', SMTP_PASS: '' };
const cli = (...args) => execFileSync(process.execPath, ['--import', './test/gh-setup.mjs', 'src/cli.js', ...args], { env, cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
const read = () => JSON.parse(fs.readFileSync(path.join(tmp, 'db.json'), 'utf8'));

test('crear, ciclo, error anotado y nada de secretos en los datos', () => {
  cli('crear', JSON.stringify({ reqId: 'r1', title: 'Hades II', platform: 'PC', target: 30 }));
  let db = read();
  assert.equal(db.trackers.length, 1);
  assert.equal(db.trackers[0].current, 18.2);
  assert.equal(db.acciones[0].id, 'r1');
  assert.equal(db.acciones[0].ok, true);
  assert.equal(db.alerts.length, 1, 'ya estaba por debajo del objetivo: avisa');
  assert.equal(db.trackers[0].art, 'https://images.igdb.com/igdb/image/upload/t_1080p/h2.jpg', 'arte grande de IGDB, no el de la banda sonora');
  assert.equal(db.trackers[0].igdb, 2);
  assert.equal(db.trackers[0].specs.Desarrolladora, 'Supergiant Games');
  assert.equal(db.alerts[0].channels.telegram, 'ok');
  assert.ok(db.sources.find(s => s.name === 'Amazon').runs > 0);

  cli('crear', JSON.stringify({ reqId: 'r2', title: 'hades ii', platform: 'PC', target: 10 }));
  db = read();
  assert.equal(db.acciones[0].ok, false);
  assert.match(db.acciones[0].error, /Ya sigues/);

  cli('editar', JSON.stringify({ reqId: 'r3', id: db.trackers[0].id, target: 12 }));
  cli('ciclo');
  db = read();
  assert.equal(db.trackers[0].target, 12);
  assert.ok(db.engine.lastRun > 0);
  assert.ok(db.logs.some(l => l.src === 'cron'));

  const raw = fs.readFileSync(path.join(tmp, 'db.json'), 'utf8');
  assert.ok(!raw.includes('secreto-123'), 'el token no se guarda');
  assert.ok(!raw.includes('"chatId"'), 'el chat tampoco');
  assert.deepEqual(db.settings.canales, { telegram: true, discord: true, email: false });

  cli('borrar', JSON.stringify({ reqId: 'r4', id: db.trackers[0].id }));
  assert.equal(read().trackers.length, 0);
});

test('modo mixto: el PC solo revisa sus tiendas y GitHub usa lo que ha leído', () => {
  const run = (modo, ...args) => execFileSync(process.execPath, ['--import', './test/gh-setup.mjs', 'src/cli.js', ...args], { env: { ...env, CG_MODO: modo }, cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
  run('nube', 'crear', JSON.stringify({ reqId: 'm1', title: 'Hades II', platform: 'PC', target: 5 }));
  const before = fs.readFileSync(path.join(tmp, 'db.json'), 'utf8');
  const id = JSON.parse(before).trackers[0].id;

  const out = run('pc', 'pc');
  assert.match(out, /revisados desde tu PC/);
  assert.equal(fs.readFileSync(path.join(tmp, 'db.json'), 'utf8'), before, 'el PC no toca db.json');
  const pcFile = path.join(tmp, 'pc.json');
  const pcData = JSON.parse(fs.readFileSync(pcFile, 'utf8'));
  assert.deepEqual(pcData.trackers[id].stores.map(s => s.name).sort(), ['Amazon', 'El Corte Inglés', 'Fnac']);

  // Desde casa Fnac sí responde: GitHub usa ese precio en vez de pedirlo él (y llevarse el captcha).
  pcData.trackers[id].stores = pcData.trackers[id].stores.map(s => (s.name === 'Fnac' ? { name: 'Fnac', type: 'retail', auto: true, url: 'https://www.fnac.es/a123', price: 16.9, match: 'Hades II PC' } : s));
  fs.writeFileSync(pcFile, JSON.stringify(pcData));
  run('nube', 'ciclo');
  let t = read().trackers[0];
  const fnac = t.stores.find(s => s.name === 'Fnac');
  assert.equal(fnac.price, 16.9);
  assert.equal(fnac.via, 'pc');
  assert.equal(t.current, 16.9);
  assert.ok(t.stores.some(s => s.name === 'Chollometro'));

  // Datos del PC de hace más de 3 horas: GitHub vuelve a intentarlo él.
  pcData.trackers[id].t = Date.now() - 4 * 60 * 60e3;
  fs.writeFileSync(pcFile, JSON.stringify(pcData));
  run('nube', 'ciclo');
  t = read().trackers[0];
  assert.match(t.stores.find(s => s.name === 'Fnac').error, /captcha/);
  assert.ok(!t.stores.some(s => s.via === 'pc'));

  assert.throws(() => run('nube', 'pc'), 'la acción pc solo vale en el runner del PC');
});
