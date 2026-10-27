# CholloGarde

Rastreador de precios de vuelos, videojuegos y productos con análisis de IA y alertas.

## Estado

| Fase | Qué incluye | Estado |
|---|---|---|
| 1 · Frontend | Dashboard SPA (Tailwind, Lucide, Chart.js) | Hecha |
| 2 · Backend | Servidor en tu PC, precios reales de videojuegos, tiempo real y alertas por Telegram, Discord y correo | Hecha (videojuegos) |
| 3 · IA | Gemini para Deal Index, predicción de compra, reseñas, comparador y copiloto | Pendiente |

**Qué es real y qué no, ahora mismo:**

- **Videojuegos (PC, PS5, PS4, Switch, Xbox): precios reales en euros.**
  - **Instant Gaming y Eneba** (keys): escribes el nombre y la plataforma y el servidor busca la ficha correcta, descartando DLC, bandas sonoras y keys de otras regiones.
  - **Cualquier otra tienda** (Amazon, MediaMarkt, Fnac, El Corte Inglés, GAME, Impact…): pegas el enlace del producto y se vigila esa ficha. Se leen los datos que las tiendas publican para Google (schema.org) y, en Amazon, su propia página.
  - **Steam España** (solo PC): precio oficial de referencia, reseñas y compatibilidad con Steam Deck.
  - Las tiendas con protección anti-bots (Amazon, MediaMarkt, Fnac, El Corte Inglés, Eneba) se abren con el **Edge** que ya tienes en Windows, en segundo plano. No hay que instalar nada más.
- **Productos y vuelos:** todavía sin fuente real. En el panel aparecen como «próximamente».
- **IA:** el Deal Index y la recomendación usan una heurística local sobre el histórico real. Gemini llega en la Fase 3.
- **Demo:** si abres `frontend/index.html` directamente (sin servidor) ves la demo con 15 trackers de ejemplo y precios simulados.

## Instalación en Windows (una sola vez)

1. Instala **Node.js LTS** desde <https://nodejs.org/es> (siguiente, siguiente…).
2. Descarga este repositorio (botón verde *Code* → *Download ZIP*) y descomprímelo donde quieras, por ejemplo en `Documentos\chollo-garde`.
3. Haz doble clic en **`windows\instalar.bat`**.

El instalador:

- instala las dependencias,
- deja CholloGarde arrancando solo cada vez que enciendes el PC (sin ventanas),
- crea un acceso directo **CholloGarde** en el escritorio,
- abre el panel en <http://localhost:8787>.

Al encender el PC, el servidor revisa todos los precios a los pocos segundos y luego cada hora (se cambia en *Notificaciones*). Si tienes el panel abierto, los precios, los logs y las alertas se actualizan en directo.

Otros scripts de `windows\`:

| Script | Para qué |
|---|---|
| `iniciar.bat` | Arranca el servidor con ventana visible (útil para ver qué pasa) |
| `parar.bat` | Para el servidor |
| `quitar-autoarranque.bat` | Quita el arranque automático y el acceso directo |

> Los datos (trackers, histórico y ajustes) se guardan en `backend\data\db.json`. Si actualizas el código, no borres esa carpeta.

## Configurar las alertas

Todo se hace en el panel, en **Notificaciones**. Cada canal tiene un botón *Enviar prueba*. Los tokens y contraseñas se guardan solo en tu PC y nunca vuelven al navegador.

**Telegram**

1. En Telegram, abre **@BotFather**, escribe `/newbot` y sigue los pasos. Te da un *token*.
2. Escribe cualquier mensaje a tu bot nuevo (si no, no puede escribirte).
3. Abre **@userinfobot** y te dice tu *chat ID* (un número).
4. Pega el token y el chat ID en el panel y pulsa *Enviar prueba*.

**Discord**

En tu servidor: *Ajustes del canal → Integraciones → Webhooks → Nuevo webhook → Copiar URL del webhook*. Pégala en el panel.

**Correo (Gmail)**

1. Activa la verificación en dos pasos de tu cuenta de Google.
2. Crea una contraseña de aplicación en <https://myaccount.google.com/apppasswords> (16 letras).
3. En el panel: *Cuenta que envía* = tu Gmail, *Contraseña de aplicación* = esas 16 letras, *Enviar alertas a* = donde quieras recibirlas.

Para Outlook/Hotmail cambia el servidor a `smtp-mail.outlook.com`, puerto `587`.

También puedes rellenar todo esto en `backend\.env` (ver `backend\.env.example`).

## Cómo funciona

```
frontend/index.html   Dashboard. Si lo sirve el backend, usa datos reales; si no, la demo.
backend/src/
  server.js           API REST + /api/stream (tiempo real) + sirve el dashboard
  engine.js           Motor: revisa los trackers cada X minutos y dispara las alertas
  games.js            Vertical de videojuegos: junta todas las tiendas y elige el mejor precio
  sources/
    keyshops.js       Búsqueda en Instant Gaming y Eneba
    web.js            Lector de fichas de producto de cualquier tienda
    browser.js        Edge/Chrome en segundo plano para las tiendas protegidas
    shops.js          Nombres y tipos de las tiendas conocidas
    steam.js          Steam España
  notify/             Telegram, Discord y correo (SMTP)
  store.js            Base de datos en data/db.json
windows/              Instalación y arranque automático
```

La alerta salta cuando `Precio_Actual <= Precio_Objetivo` y la alerta del tracker está activa. Solo avisa una vez; vuelve a avisar si el precio sube por encima del objetivo y vuelve a bajar.

### API

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/state` | Trackers, alertas, ajustes (sin secretos), estado del motor, logs y fuentes |
| GET | `/api/stream` | Server-Sent Events: `log`, `tracker`, `tracker-removed`, `alert`, `engine`, `settings` |
| POST | `/api/fetch-meta` | `{ title, platform, keys, links }` → vista previa con el precio de cada tienda |
| POST | `/api/trackers` | `{ previewId, target, alert }` (o los mismos campos de la vista previa) → crea el tracker |
| PATCH | `/api/trackers/:id` | `{ target }`, `{ alert }`, `{ links }` y/o `{ keys }`. Cambiar tiendas lanza una comprobación |
| DELETE | `/api/trackers/:id` | Borra el tracker |
| POST | `/api/trackers/:id/scan` | Rastrea ese tracker ahora |
| POST | `/api/engine` | `{ action: "start" \| "stop" \| "run" }` |
| GET/PUT | `/api/settings` | Ajustes. Un secreto vacío significa «no lo cambies» |
| POST | `/api/notify/test` | `{ channel: "telegram" \| "discord" \| "email" \| "all" }` |
| POST | `/api/ai/:task` | Reservado para Gemini (Fase 3); hoy responde 501 |

### Desarrollo

```bash
cd backend
npm install
npm start      # http://localhost:8787
npm test       # pruebas de extremo a extremo con las tiendas y APIs simuladas
```

## Limitaciones conocidas

- Las tiendas no tienen API: se leen sus páginas. Si una tienda cambia su web o pide un captcha, esa tienda sale como «sin precio» con el motivo, se conserva su último precio marcado como antiguo y el resto sigue funcionando. Se reintenta en el siguiente ciclo.
- Si una tienda protegida falla a menudo, pon `BROWSER_VISIBLE=1` en `backend/.env`, reinicia y resuelve el captcha una vez en la ventana de Edge: las cookies se guardan en `data/navegador`.
- Las keys de Instant Gaming y Eneba son de revendedores: revisa región y plataforma antes de comprar.
- El histórico empieza el día que creas el tracker.

## Siguientes pasos

- **PS Store, eShop y Xbox** como referencia oficial en consola.
- **Productos:** Keepa para Amazon (de pago) y un scraper con navegador para PcComponentes, AliExpress y El Corte Inglés.
- **Vuelos:** conector para Skyscanner, Google Flights o Kayak.
- **Fase 3:** Gemini detrás de `/api/ai/:task`.
- **Acceso desde fuera de tu PC** (por ejemplo, para tu hermano): túnel de Cloudflare con contraseña (`DASHBOARD_PASSWORD`), o un VPS/Raspberry con el `docker-compose.yml` incluido.
