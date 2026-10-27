# Para ejecutar CholloGarde en un VPS o Raspberry Pi (opcional; en tu PC basta con windows/instalar.bat).
FROM node:22-alpine
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend/ ./
COPY frontend/ /app/frontend/
ENV HOST=0.0.0.0 DATA_DIR=/data IN_DOCKER=1
EXPOSE 8787
CMD ["node", "src/index.js"]
