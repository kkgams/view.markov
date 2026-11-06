---
title: Development
status: reference
---

# view.markov

Edit the canonical View JavaScript under `src/`, then run `npm test`.
`make open` checks the source and opens this repository’s `gams.json` in the
downloaded released macOS Apple Silicon Host. Required published Units install
on first startup; network access is required. No sibling checkout is used.

Use `make serve-docs DOCS_PORT=8081` for an independent local documentation port,
`make validate-docs` to validate links, and `make docs` to build the portable
site under `build/site/`. The engine is justgook/wiki v1.4.0.
Every push to `release` publishes documentation through GitHub Pages, independently
of Unit version tags. Select GitHub Actions as the Pages source.
