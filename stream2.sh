#!/usr/bin/env bash

set -eu

cd "$(dirname "$0")"
echo "[compat] stream2.sh -> client.sh"
exec ./client.sh "$@"
