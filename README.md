# CholloGarde

Rastreador de precios de vuelos, videojuegos y productos con análisis de IA y alertas.

## Estado

| Fase | Qué incluye | Estado |
|---|---|---|
| 1 · Frontend | Dashboard SPA (Tailwind, Lucide, Chart.js) | Hecha |
| 2 · Backend | Servidor en tu PC, precios reales de videojuegos, tiempo real y alertas por Telegram, Discord y correo | Hecha (videojuegos) |
| 3 · IA | Gemini para Deal Index, predicción de compra, reseñas, comparador y copiloto | Pendiente |

**Qué es real y qué no, ahora mismo:**

- **Videojuegos (PC, PS5, PS4, Switch 2, Switch, Xbox): precios reales en euros.**
  - **Búsqueda automática** en Instant Gaming y Eneba (keys) y en Amazon, MediaMarkt, Fnac, El Corte Inglés, GAME e Impact: escribes el nombre y la plataforma y el servidor elige la ficha correcta (plataforma, edición estándar antes que la de coleccionista, sin DLC, segunda mano, accesorios ni keys de otras regiones). La ficha encontrada se recuerda: en cada ciclo solo se relee su precio, y se vuelve a buscar si deja de valer.
  - **Enlaces opcionales**: para cualquier otra tienda, o para corregir una búsqueda que haya cogido otra versión (el enlace manda sobre la búsqueda). Se leen los datos que las tiendas publican para Google (schema.org) y, en Amazon, su propia página.
  - **Steam España** (solo PC): precio oficial de referencia, reseñas y compatibilidad con Steam Deck.
  - Las tiendas con protección anti-bots (Amazon, MediaMarkt, Fnac, El Corte Inglés, Eneba) se abren con el **Edge** que ya tienes en Windows, en segundo plano. No hay que instalar nada más.
- **Productos y vuelos:** todavía sin fuente real. En el panel aparecen como «próximamente».
- **IA:** el Deal Index y la recomendación usan una heurística local sobre el histórico real. Gemini llega en la Fase 3.
- **Demo:** si abres `frontend/index.html` directamente (sin servidor) ves la demo con 15 trackers de ejemplo y precios simulados.

## Usarlo en GitHub, sin el PC (recomendado)

GitHub Actions revisa los precios cada hora y el panel se publica en GitHub Pages: `https://javi9elgarde.github.io/Chollo-Garde/`. Funciona con el PC apagado, desde el móvil, y cualquiera con el enlace puede mirarlo.

Pasos (solo una vez):

1. **Hacer público el repositorio**: *Settings → General → Danger Zone → Change visibility → Public*. Hace falta para usar GitHub Pages gratis. Las claves no se publican: van en los secretos (paso 2) y los datos se guardan sin ellas.
2. **Poner las claves**: en *Settings → Secrets and variables → Actions → New repository secret*. Pon solo las de los canales que quieras usar:
   - `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`
   - `DISCORD_WEBHOOK_URL`
   - `SMTP_USER`, `SMTP_PASS` y `ALERT_EMAIL_TO`; opcionalmente `SMTP_HOST` y `SMTP_PORT` (por defecto, Gmail)
3. **Activar Pages**: *Settings → Pages → Build and deployment → Source: GitHub Actions*. Después, en la pestaña *Actions*, abre «Publicar panel» y pulsa *Run workflow*.
4. **Primera revisión**: en *Actions*, abre «Rastreo de precios» y pulsa *Run workflow*. A partir de ahí se ejecuta solo cada hora.
5. **Token para el panel**: la primera vez que añadas un juego desde el panel te pedirá un token de GitHub, con instrucciones. Se guarda solo en ese navegador. Para solo mirar no hace falta.

Cómo funciona: `.github/workflows/rastreo.yml` ejecuta `backend/src/cli.js`, que guarda los trackers, el histórico y las alertas en `db.json`, en la rama `datos`. El panel lee ese fichero y, cuando creas o cambias algo, lanza el mismo workflow con tu token. Cada petición tarda de 2 a 5 minutos, y los precios se revisan cada hora (GitHub a veces lo retrasa unos minutos).

### Modo mixto: tu PC revisa Amazon, Fnac y El Corte Inglés (sin captchas)

Esas tres tiendas piden captcha a los servidores de GitHub. Desde la conexión de casa no. Con el modo mixto, un "runner" de GitHub instalado en tu PC revisa solo esas tres tiendas cada hora (workflow «Rastreo desde tu PC») y sube los precios a `pc.json`, en la rama `datos`. El ciclo de GitHub usa esos precios si son de las últimas 3 horas; con el PC apagado, GitHub lo intenta él como hasta ahora. En la ficha de cada juego verás «desde tu PC» al lado de esas tiendas.

Pasos (solo una vez, en el PC con Windows):

1. Instala **Git for Windows** (<https://git-scm.com/download/win>, todo por defecto). Node no hace falta: lo pone el propio workflow. Edge ya viene con Windows.
2. **Protege el repositorio**, porque es público y el runner ejecuta código en tu PC: *Settings → Actions → General → Fork pull request workflows from outside collaborators* → **Require approval for all outside collaborators**. Nunca apruebes ejecuciones de PRs de desconocidos.
3. En GitHub: *Settings → Actions → Runners → New self-hosted runner → Windows*. Copia los comandos de **Download** y **Configure** en PowerShell, dentro de una carpeta como `C:\actions-runner`. Durante la configuración:
   - nombre del runner: el que quieras;
   - **etiquetas adicionales: `chollogarde-pc`** (importante);
   - «Would you like to run the runner as service?»: **Y** (así arranca solo con Windows).
4. En *Actions → Rastreo desde tu PC → Run workflow* lánzalo una vez para comprobar que funciona. Después se ejecuta solo cada hora mientras el PC esté encendido.

Si el PC está apagado mucho tiempo, GitHub deja una sola ejecución esperando; si pasa más de 24 h sin poder ejecutarla, la cancela y te avisa por correo. No es un error de CholloGarde.

### Arte de los juegos (RAWG, como el Refugio 111)

Las tarjetas de juegos usan la imagen apaisada de RAWG, la misma base de datos del Refugio 111. Añade la clave en *Settings → Secrets and variables → Actions → New repository secret* con el nombre `RAWG_API_KEY`. Vale la misma clave que usa el Refugio, o una nueva gratis en <https://rawg.io/apidocs>. Sin la clave se sigue viendo la carátula de la tienda.

### Reloj: un ciclo cada hora de verdad

El `schedule` de GitHub es aproximado y a veces se salta horas enteras. El workflow «Reloj (ciclo cada hora)» se queda en marcha casi 6 horas lanzando «Rastreo de precios» cada hora y, al acabar, se vuelve a lanzar solo. Para arrancarlo la primera vez: *Actions → Reloj → Run workflow*. Para pararlo: *Disable workflow*.

### Chollometro

Además de las tiendas, cada juego se busca en Chollometro. Si hay una oferta activa de ese juego y plataforma (de los últimos 45 días, sin caducar), aparece como una tienda más, con la tienda de la oferta, el código de descuento si lo lleva y los grados. Cuenta para el precio actual y para las alertas: si alguien publica el juego por debajo de tu objetivo, te avisa.

## Instalación en Windows (alternativa: en tu PC)

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
    keyshops.js       Búsqueda en Instant Gaming y Eneba, y cómo se elige la versión correcta
    retail.js         Búsqueda en Amazon, MediaMarkt, Fnac, El Corte Inglés, GAME e Impact
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
| GET | `/api/shops` | Tiendas con búsqueda automática y plataformas |
| POST | `/api/fetch-meta` | `{ title, platform, shops, links }` → vista previa con el precio de cada tienda |
| POST | `/api/trackers` | `{ previewId, target, alert }` (o los mismos campos de la vista previa) → crea el tracker |
| PATCH | `/api/trackers/:id` | `{ target }`, `{ alert }`, `{ links }` y/o `{ shops }`. Cambiar tiendas lanza una comprobación |
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
