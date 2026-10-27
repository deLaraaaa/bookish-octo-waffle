FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "server/server.js"]
