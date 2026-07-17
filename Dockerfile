FROM node:22-alpine

RUN apk add --no-cache wget curl

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1

CMD ["node", "index.js"]
