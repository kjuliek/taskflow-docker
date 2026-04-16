# =============================================================================
# Stage 1 — builder
# Install all dependencies (including devDependencies), then prune to
# production-only. devDeps never reach the final image.
# =============================================================================
FROM node:20.19-alpine3.23 AS builder

WORKDIR /app

# Copy manifests first — Docker caches this layer until package*.json changes
COPY package.json package-lock.json ./

# Install everything (devDeps needed for potential build steps)
RUN npm ci

# Copy application source
COPY src/ ./src/

# Remove devDependencies — node_modules now contains production deps only
RUN npm prune --production

# =============================================================================
# Stage 2 — production
# Lean runtime image: only production node_modules + source code.
# The builder stage is discarded; its layers do not exist in the final image.
# =============================================================================
FROM node:20.19-alpine3.23 AS production

WORKDIR /app

# Dedicated non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy pruned node_modules and source from builder, setting correct ownership
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/src         ./src
COPY --from=builder --chown=appuser:appgroup /app/package.json ./

# Drop to non-root before the process starts
USER appuser

EXPOSE 3000

ENV NODE_ENV=production

# wget is available in alpine; healthcheck polls /health every 30s
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
