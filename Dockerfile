FROM node:22-alpine

WORKDIR /app

# Das Projekt hat bewusst keine Runtime-Dependencies, daher kein npm install.
COPY package.json ./
COPY src ./src

RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production \
    STATE_FILE=/app/data/state.json

USER node
VOLUME ["/app/data"]

# Standard: laeuft dauerhaft und prueft selbst im Intervall.
# Fuer den Betrieb ueber einen externen Scheduler stattdessen
# `sleep infinity` als Command setzen und `node /app/src/index.js` als Task ausfuehren.
CMD ["node", "src/index.js", "--watch"]
