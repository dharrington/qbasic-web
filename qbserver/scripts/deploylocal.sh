#!/bin/bash
cd "$(dirname "$0")/.."
set -e
./node_modules/.bin/webpack-cli --config webpack.config.js --mode=development
./scripts/serveit.py 8223
