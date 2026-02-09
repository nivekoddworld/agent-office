FROM node:22-slim

# node:22-slim already provides user "node" with uid=1000 gid=1000

# Build toolchain for npm native modules (node-gyp)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
ENV PYTHON=/usr/bin/python3

WORKDIR /app

COPY sandbox/package.json ./
RUN npm install

COPY agent/entrypoints/sandbox-entry.ts ./agent/entrypoints/
COPY agent/tools/contracts.ts ./agent/tools/
COPY agent/tools/proxy/ ./agent/tools/proxy/
COPY security/ ./security/

RUN chown -R node:node /app

USER node
EXPOSE 3100

CMD ["npx", "tsx", "agent/entrypoints/sandbox-entry.ts"]
