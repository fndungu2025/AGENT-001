#!/usr/bin/env bash
# Netlify build: the analytics app at / and the research documents at /research/.
# Output: netlify-dist/
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. The app (Vite + React). Dependencies are installed by Netlify from pnpm-lock.yaml.
pnpm --filter @customeriq/web build

# 2. The research documents site (copies the Markdown and pinned viewer libraries into site/).
bash scripts/build-site.sh

# 3. Assemble.
rm -rf netlify-dist
mkdir -p netlify-dist/research
cp -R apps/web/dist/. netlify-dist/
tar --exclude=node_modules --exclude=package.json --exclude=package-lock.json -C site -cf - . \
  | tar -C netlify-dist/research -xf -

echo "Built netlify-dist/: app at / and research documents at /research/"
