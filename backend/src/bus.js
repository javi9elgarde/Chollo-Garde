// Bus de eventos en memoria: todo lo que pasa en el servidor se emite aquí
// y /api/stream lo reenvía al dashboard en tiempo real (Server-Sent Events).
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

const logs = [];
export function log(level, src, msg) {
  const l = { t: Date.now(), level, src, msg };
  logs.push(l);
  if (logs.length > 500) logs.shift();
  const tag = { info: 'INFO', ok: ' OK ', warn: 'WARN', err: 'ERR ', ai: ' IA ' }[level] || level;
  console.log(`${new Date(l.t).toLocaleTimeString('es-ES')} ${tag} [${src}] ${msg}`);
  bus.emit('event', 'log', l);
  return l;
}
export const recentLogs = () => logs.slice(-300);
export const emit = (type, data) => bus.emit('event', type, data);
