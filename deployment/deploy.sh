#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"

mkdir -p runtime/data runtime/music

docker compose --project-name rime -f compose.yml build --pull
docker compose --project-name rime -f compose.yml up --detach --remove-orphans --wait --wait-timeout 180

port=${RIME_HTTP_PORT:-18081}
curl --fail --silent --show-error --retry 10 --retry-delay 2 "http://127.0.0.1:${port}/healthz" >/dev/null

printf 'Rime is healthy on 127.0.0.1:%s\n' "$port"
