#!/bin/sh
# Type-check + production build.
set -e
cd "$(dirname "$0")/.."
./node_modules/.bin/tsc --noEmit
echo "TSC OK"
./node_modules/.bin/vite build
