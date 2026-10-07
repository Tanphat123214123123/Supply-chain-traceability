FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# The migrator reads SQL files from <app>/migrations at runtime (dist/db/../../migrations).
COPY migrations ./migrations
USER node
EXPOSE 3000
# Same image, two entrypoints:
#   API:        node dist/index.js        (default)
#   migrations: node dist/db/migrate.js   (run once per deploy, before the API)
CMD ["node", "dist/index.js"]
