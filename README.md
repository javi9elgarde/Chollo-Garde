# CholloGarde

Rastreador de precios de vuelos, videojuegos y productos con análisis de IA y alertas.

## Estado

| Fase | Qué incluye | Estado |
|---|---|---|
| 1 · Frontend | Dashboard SPA (Tailwind, Lucide, Chart.js) con datos simulados | Hecha |
| 2 · Backend | Servidor local con scrapers/APIs, base de datos y alertas por Telegram, Discord y correo | Pendiente |
| 3 · IA | Gemini para Deal Index, predicción de compra, reseñas, comparador y copiloto | Pendiente |

> En la Fase 1 **todos los precios son de ejemplo**. Ninguno se lee todavía de las tiendas.

## Fase 1: probar el dashboard

Abre `frontend/index.html` en el navegador. No necesita instalación.

## Cómo se conectan las fases 2 y 3

El frontend ya llama a estas capas (ver el bloque `<script>` de `frontend/index.html`):

- `API.mode = 'live'` → `POST /api/fetch-meta`, `GET/POST /api/trackers`
- `AI.provider = 'gemini'` → `POST /api/ai/:task` (los prompts están en `AI.PROMPTS` y esperan JSON)
- `Notify.telegramPayload`, `Notify.discordPayload`, `Notify.emailPayload` → formato de cada alerta
- `engine` → simula el ciclo de rastreo; en la Fase 2 lo sustituye el servidor

## Decisiones para la Fase 2

- Se ejecuta en el PC del usuario mientras está encendido (sin VPS por ahora) y actualiza el dashboard en tiempo real.
- Canales de alerta: Telegram, Discord y correo (SMTP).
- Primera fuente real: CheapShark (videojuegos, gratis y sin clave).
