# agent-office orchestrator: scheduler + web UI + agents (in-process, or one
# sandbox container per agent with --sandbox docker). Usage: see README.md.

# Docker CLI, used to start per-agent sandbox containers (--sandbox docker).
FROM docker:29-cli AS dockercli

FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY ui/package.json ui/pnpm-lock.yaml ./ui/
RUN pnpm -C ui install --frozen-lockfile

COPY . .
RUN pnpm ui:build

FROM node:22-slim

# Tools the agents' coding tools shell out to (Pi finds fd as "fdfind").
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git ripgrep fd-find curl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-buildx \
     /usr/local/libexec/docker/cli-plugins/docker-buildx

WORKDIR /app
COPY --from=build /app/package.json /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/examples ./examples
COPY --from=build /app/ui/dist ./ui/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# node:22-slim provides user "node" (uid 1000), which agent-office runs as.
# /app stays writable for the .env the UI may append missing provider keys to.
RUN mkdir -p /home/node/.agent-office \
    && chown node:node /home/node/.agent-office /app

ENV AGENT_OFFICE_IN_CONTAINER=1 \
    UI_HOST=0.0.0.0 \
    UI_PORT=3847 \
    PI_OFFLINE=1

# Starts as root only to grant the Docker socket's group, then runs as node
# (see docker-entrypoint.sh).
EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${UI_PORT}/" > /dev/null || exit 1

ENTRYPOINT ["tini", "--", "docker-entrypoint.sh"]
CMD ["--help"]
