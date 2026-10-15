# syntax=docker/dockerfile:1
# Single image: the NestJS API also serves the built React app from /app/public.

# ---- frontend build ----
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
ARG VITE_APP_NAME
ENV VITE_APP_NAME=${VITE_APP_NAME}
RUN npm run build

# ---- backend build ----
FROM node:20-alpine AS api
WORKDIR /api
RUN apk add --no-cache python3 make g++
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 UPLOAD_DIR=/app/uploads
COPY --from=api /api/node_modules ./node_modules
COPY --from=api /api/dist ./dist
COPY --from=api /api/package.json ./
COPY --from=web /web/dist ./public
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/main"]
