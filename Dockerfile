FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production \
    STATE_FILE=/app/data/state.json \
    WA_AUTH_DIR=/app/data/wa-auth

USER node
VOLUME ["/app/data"]

# Laeuft als Dienst: haelt die WhatsApp-Verbindung und prueft im Intervall.
# Beim ersten Start erscheint der QR-Code zum Koppeln im Container-Log.
CMD ["node", "src/index.js"]
