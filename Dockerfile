FROM node:22-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

CMD ["node", "index.js"]
