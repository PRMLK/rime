#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || ! printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$'; then
    echo "usage: $0 <git-commit-sha>" >&2
    exit 2
fi

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"

mkdir -p runtime
exec 9>runtime/deploy.lock
if ! flock -n 9; then
    echo "another deployment is already running" >&2
    exit 1
fi

revision=$1
git fetch --quiet origin main
git cat-file -e "${revision}^{commit}"

if ! git merge-base --is-ancestor "$revision" origin/main; then
    echo "refusing to deploy a commit outside origin/main" >&2
    exit 1
fi

git -c advice.detachedHead=false checkout --quiet --detach "$revision"
exec ./deployment/deploy.sh
