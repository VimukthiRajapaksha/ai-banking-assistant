# Build stage
FROM node:18-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Production stage
FROM node:18-alpine AS runner

WORKDIR /app
RUN npm install -g pnpm

ENV NODE_ENV=production

# Create a non-root user
RUN addgroup --system --gid 10001 nodejs
RUN adduser --system --uid 10001 nextjs

# Copy package files for production dependencies
COPY package.json pnpm-lock.yaml ./

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built application from builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs

# Change ownership to nextjs user
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER 10001

# Expose port 8000 (as specified in your .env.local)
EXPOSE 8000

# Set environment variables
ENV PORT=8000
ENV HOSTNAME="0.0.0.0"

# Start the application
CMD ["pnpm", "start"]
