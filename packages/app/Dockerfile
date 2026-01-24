FROM oven/bun:latest AS builder

WORKDIR /app

# Copy the entire workspace
COPY . .

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
COPY packages/app/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
