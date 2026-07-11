FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# `npm ci` fails here — verified against this exact lockfile in node:20-alpine,
# it's NOT a Windows/musl platform mismatch (all @esbuild/* and
# @rollup/rollup-linux-x64-* variants are already present). The real cause is
# Vite 5's optional experimental rolldown native binding pulling in
# @emnapi/*/esbuild@0.28.1 sub-dependencies that this lockfile doesn't fully
# pin, so `npm ci`'s strict lock-vs-package.json check rejects it. `npm install`
# resolves those transitively instead of failing closed. This does trade away
# build reproducibility — if that matters more than working around the
# rolldown drift, regenerate package-lock.json deliberately (as its own
# reviewed change) and switch back to `npm ci`.
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
