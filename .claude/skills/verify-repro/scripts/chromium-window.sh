#!/bin/sh
# src/browser.ts fixes Chromium's flags and headless defaults to a ~756x413 viewport, which
# cuts the dashboard's tables out of every screenshot. This adds a window size and nothing
# else, then defers to the repository's own launcher for the private profile.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
exec "$here/../../../../scripts/headless-chromium.sh" --window-size="${REPRO_VERIFY_WINDOW:-1280,1000}" "$@"
