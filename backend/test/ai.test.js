// Fase 3 · Gemini simulado: análisis en cada ciclo, «Regenerar», cuota agotada y sin clave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJson, dealPayload } from '../src/ai.js';

const setup = extra => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ai-'));
  const env = { ...process.env, DATA_DIR: tmp, CG_PUBLIC_DATA: '1', TELEGRAM_BOT_TOKEN: '', SMTP_USER: '', GEMINI_API_KEY: 'clave-gemini-secreta', GEMINI_MODEL: '', ...extra };
  const cli = (...args) => execFileSync(process.execPath, ['--import', './test/gh-setup.mjs', 'src/cli.js', ...args], { env, cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
  return { cli, read: () => JSON.parse(fs.readFileSync(path.join(tmp, 'db.json'), 'utf8')), raw: () => fs.readFileSync(path.join(tmp, 'db.json'), 'utf8') };
};

test('al crear, Gemini analiza el precio y resume reseñas (con Google si Steam no tiene textos)', () => {
  const { cli, read, raw } = setup();
  cli('crear', JSON.stringify({ reqId: 'a1', title: 'Hades II', platform: 'PC', target: 10 }));
  const db = read(), it = db.trackers[0];
  assert.equal(it.ai.score, 100, 'el score se limita a 1-100');
  assert.equal(it.ai.recomendacion, 'COMPRAR_AHORA');
  assert.equal(it.ai.price, it.current);
  assert.equal(it.ai.model, 'gemini-3.0-flash', 'el Flash estable más reciente, sin preview ni pro');
  assert.equal(it.ai.motivos.length, 2);
  assert.deepEqual(it.reviews.pros, ['Combate profundo'], 'JSON dentro de ```json``` y sin el texto de «pensando»');
  assert.match(it.reviews.src, /resumen de Gemini/);
  assert.equal(it.reviews.ai.from, 'vandal.net, ign.com');
  assert.deepEqual({ on: db.ai.on, ok: db.ai.ok, failed: db.ai.failed }, { on: true, ok: 2, failed: 0 });
  assert.ok(!raw().includes('clave-gemini-secreta'), 'la clave no se guarda');

  // Mismo precio y análisis reciente: el ciclo no gasta cuota.
  cli('ciclo');
  assert.equal(read().trackers[0].ai.at, it.ai.at);
  // «Regenerar» lo rehace todo.
  cli('analizar', JSON.stringify({ reqId: 'a2', id: it.id }));
  const after = read();
  assert.ok(after.trackers[0].ai.at > it.ai.at);
  assert.equal(after.acciones[0].ok, true);
});

test('reseñas de Steam cuando las hay', () => {
  const { cli, read } = setup({ MOCK_STEAM_REVIEWS: '1', GEMINI_MODEL: 'gemini-2.5-flash' });
  cli('crear', JSON.stringify({ reqId: 's1', title: 'Hades II', platform: 'PC', target: 10 }));
  const it = read().trackers[0];
  assert.equal(it.ai.model, 'gemini-2.5-flash');
  assert.deepEqual(it.reviews.pros, ['Combate adictivo', 'Gran música', 'Muy rejugable']);
  assert.equal(it.reviews.ai.from, 'Steam');
  assert.equal(it.reviews.rating, 4.8, 'la nota de Steam manda sobre la de Gemini');
});

test('cuota agotada: se anota y el tracker sigue sin análisis', () => {
  const { cli, read } = setup({ MOCK_GEMINI_QUOTA: '1' });
  cli('crear', JSON.stringify({ reqId: 'q1', title: 'Hades II', platform: 'PC', target: 10 }));
  const db = read();
  assert.equal(db.acciones[0].ok, true, 'crear funciona aunque Gemini falle');
  assert.equal(db.trackers[0].ai, undefined);
  assert.match(db.ai.error, /Cuota/);
  assert.equal(db.ai.failed, 1, 'tras la cuota no se sigue intentando');
  cli('analizar', JSON.stringify({ reqId: 'q2', id: db.trackers[0].id }));
  assert.match(read().acciones[0].error, /Cuota/);
});

test('sin clave no se llama a Gemini', () => {
  const { cli, read } = setup({ GEMINI_API_KEY: '' });
  cli('crear', JSON.stringify({ reqId: 'n1', title: 'Hades II', platform: 'PC', target: 10 }));
  const db = read();
  assert.equal(db.trackers[0].ai, undefined);
  assert.deepEqual(db.ai, { on: false });
  cli('analizar', JSON.stringify({ reqId: 'n2', id: db.trackers[0].id }));
  assert.match(read().acciones[0].error, /GEMINI_API_KEY/);
});

test('JSON con texto alrededor e histórico de un punto por día', () => {
  assert.deepEqual(parseJson('Claro:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJson('nada'), /JSON/);
  const t0 = new Date('2026-10-01T10:00:00').getTime();
  const p = dealPayload({ title: 'X', platform: 'PS5', current: 40, target: 30, msrp: 80, stores: [{ name: 'GAME', price: 40 }, { name: 'Fnac', error: 'captcha' }], history: [{ t: t0, p: 50 }, { t: t0 + 3600e3, p: 45 }, { t: t0 + 864e5, p: 40 }] }, t0 + 2 * 864e5);
  assert.deepEqual(p.historico, [{ fecha: '2026-10-01', precio: 45 }, { fecha: '2026-10-02', precio: 40 }]);
  assert.equal(p.tiendas.length, 1);
  assert.equal(p.minimo_registrado, 40);
});
