# ============================================
# Stage 1: Install production dependencies
# ============================================
FROM node:20-alpine AS deps

WORKDIR /usr/src/app

# Copy only package manifests first for optimal layer caching
COPY package.json package-lock.json* ./

# Install production dependencies only (ci for deterministic builds)
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# ============================================
# Stage 2: Production image
# ============================================
FROM node:20-alpine

# Security: upgrade system packages, install tini for proper PID 1 signal handling, then clean up
RUN apk update && apk upgrade --no-cache \
    && apk add --no-cache tini curl \
    && rm -rf /var/cache/apk/*

# Set production environment
ENV NODE_ENV=production

WORKDIR /usr/src/app

# Copy production dependencies from deps stage
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy application source code
COPY package.json ./
COPY server.js ./
COPY src/ ./src/

# Security: create non-root user and set ownership
RUN addgroup -g 1001 -S appgroup \
    && adduser -S appuser -u 1001 -G appgroup \
    && chown -R appuser:appgroup /usr/src/app

USER appuser

EXPOSE 5000

# Health check — adjust the endpoint to your actual health route
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5000/api/health || exit 1

# Use tini as init system for proper signal forwarding (graceful shutdown)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]