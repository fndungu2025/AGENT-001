#!/usr/bin/env bash
# Builds the static docs site Netlify publishes from site/.
# Copies the research documents and the pinned viewer libraries next to the page.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --prefix site --no-audit --no-fund
rm -rf site/docs site/vendor
mkdir -p site/docs site/vendor
cp research/viability-analysis.md research/tech-stack.md research/PRD.md \
   research/skills.md research/agents.md research/roadmap.md site/docs/
cp .claude/CLAUDE.md site/docs/project-memory.md
cp site/node_modules/marked/marked.min.js \
   site/node_modules/dompurify/dist/purify.min.js \
   site/node_modules/mermaid/dist/mermaid.min.js site/vendor/
echo "Built site/ with $(ls site/docs | wc -l) documents"
