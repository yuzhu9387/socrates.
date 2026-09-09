FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY demo/package.json demo/package-lock.json ./demo/
RUN npm ci --prefix demo
COPY demo ./demo
RUN npm --prefix demo run build:app
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app/server/node_modules ./server/node_modules
COPY --chown=node:node server ./server
COPY --from=build --chown=node:node /app/demo/dist-app ./demo/dist-app
COPY --chown=node:node demo/src/model.js demo/src/board-palette.js ./demo/src/
COPY --chown=node:node demo/package.json ./demo/package.json
USER node
EXPOSE 3001
CMD ["node", "server/src/index.mjs"]
