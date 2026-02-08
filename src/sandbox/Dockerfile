FROM node:22-slim

# node:22-slim already provides user "node" with uid=1000 gid=1000

WORKDIR /app

COPY sandbox/package.json ./
RUN npm install

COPY agent/entrypoints/sandbox-entry.ts ./agent/entrypoints/
COPY agent/tools/contracts.ts ./agent/tools/
COPY agent/tools/proxy/ ./agent/tools/proxy/

RUN chown -R node:node /app

USER node
EXPOSE 3100

CMD ["npx", "tsx", "agent/entrypoints/sandbox-entry.ts"]
