#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
echo "[compat] stream.sh -> client.sh"
exec ./client.sh "$@"
