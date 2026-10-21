#!/bin/sh
# Run Playwright smoke tests (uses system Chrome channel if bundled browsers missing).
cd "$(dirname "$0")/.."
./node_modules/.bin/playwright install chromium >/dev/null 2>&1 || true
./node_modules/.bin/playwright test "$@"
