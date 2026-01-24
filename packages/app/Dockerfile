FROM oven/bun:latest AS builder

WORKDIR /app

# Copy root configuration files (required for workspace catalogs)
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY patches ./patches

# Copy packages directory
COPY packages ./packages

# Install dependencies
RUN bun install --frozen-lockfile

# Build the app explicitly
WORKDIR /app/packages/app
RUN bun run build

# Serve Stage
FROM nginx:alpine

# Copy built assets from the builder stage
COPY --from=builder /app/packages/app/dist /usr/share/nginx/html

# Copy custom nginx configuration
COPY --from=builder /app/packages/app/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
