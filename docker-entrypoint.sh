#!/bin/sh
# Starts agent-office as the unprivileged "node" user. Runs as root only to
# let "node" use the Docker socket when one is mounted (for --sandbox docker):
# the socket's group id differs between Docker hosts, so it is looked up here.
set -e
export HOME=/home/node
if [ "$(id -u)" = "0" ]; then
  groups=""
  if [ -S /var/run/docker.sock ]; then
    groups="--groups=$(stat -c %g /var/run/docker.sock)"
  else
    groups="--clear-groups"
  fi
  exec setpriv --reuid=node --regid=node $groups -- \
    node_modules/.bin/tsx src/index.ts "$@"
fi
exec node_modules/.bin/tsx src/index.ts "$@"
