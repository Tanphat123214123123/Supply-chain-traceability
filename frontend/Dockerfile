FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Anchoring config for the browser verifier (see docker-compose.yml).
ARG VITE_ANCHOR_CHAIN_ID
ARG VITE_ANCHOR_CONTRACT
ARG VITE_ANCHOR_RPC_URLS
ARG VITE_ANCHOR_EXPLORER_URL
ENV VITE_ANCHOR_CHAIN_ID=$VITE_ANCHOR_CHAIN_ID \
    VITE_ANCHOR_CONTRACT=$VITE_ANCHOR_CONTRACT \
    VITE_ANCHOR_RPC_URLS=$VITE_ANCHOR_RPC_URLS \
    VITE_ANCHOR_EXPLORER_URL=$VITE_ANCHOR_EXPLORER_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Let the CSP connect-src allow exactly the configured RPC origins (scheme://host[:port]).
ARG VITE_ANCHOR_RPC_URLS
COPY csp-rpc-origins.sh /tmp/csp-rpc-origins.sh
RUN sh /tmp/csp-rpc-origins.sh "$VITE_ANCHOR_RPC_URLS" /etc/nginx/conf.d/default.conf && rm /tmp/csp-rpc-origins.sh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
