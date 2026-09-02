#!/bin/sh
set -eu

set -- ${SSH_ORIGINAL_COMMAND:-}
if [ "$#" -ne 2 ] || [ "$1" != "deploy" ] || ! printf '%s' "$2" | grep -Eq '^[0-9a-f]{40}$'; then
    echo "this key may only deploy a 40-character Git commit SHA" >&2
    exit 1
fi

exec "$HOME/apps/rime/deployment/update.sh" "$2"
