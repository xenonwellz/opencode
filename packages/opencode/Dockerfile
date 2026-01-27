# Build stage
FROM ubuntu:22.04 AS builder

# Avoid prompts from apt
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    ca-certificates \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

# Add build arguments for versioning
ARG OPENCODE_CHANNEL=latest
ARG OPENCODE_VERSION
ENV OPENCODE_CHANNEL=$OPENCODE_CHANNEL
ENV OPENCODE_VERSION=$OPENCODE_VERSION

# Copy root configuration files for workspace support
COPY package.json bun.lock bunfig.toml tsconfig.json turbo.json ./
COPY patches ./patches

# Copy all packages for workspace resolution
COPY packages ./packages

# Install dependencies
RUN bun install --frozen-lockfile

# Build opencode
WORKDIR /app/packages/opencode
RUN bun run build --single && \
    if [ -f "dist/opencode-linux-x64/bin/opencode" ]; then \
        mv dist/opencode-linux-x64/bin/opencode /app/opencode-bin; \
    elif [ -f "dist/opencode-linux-arm64/bin/opencode" ]; then \
        mv dist/opencode-linux-arm64/bin/opencode /app/opencode-bin; \
    fi

# Runtime stage
FROM ubuntu:22.04

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libgcc-s1 \
    libstdc++6 \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the built binary from the builder stage
COPY --from=builder /app/opencode-bin /usr/local/bin/opencode

# Ensure the binary is executable
RUN chmod +x /usr/local/bin/opencode

# Expose the default port
EXPOSE 4096

# Set the entrypoint and default command
ENTRYPOINT ["opencode"]
CMD ["serve", "--hostname", "0.0.0.0"]
