# view.markov

MarkovJunior XML generation View for [GAMS](https://github.com/kkgams/gams), with canvas and voxel rendering. The local Project opens `local.xml`; generation uses the pinned Project-configured plugin and Host-owned XML compiler/rendering helpers.

| View | Source → deployed file | Screenshot | Original work |
| --- | --- | --- | --- |
| Markov (`view-markov`) | `src/view.markov/views/view-markov.js` → `views/view-markov.js` | Not available | GAMS authors |

The ZIP includes [Apache-2.0](LICENSE), [NOTICE](NOTICE) and [licensing scope](LICENSING.md).

## Development

Requires Make, Node.js, Python 3, curl, zip, unzip and tar. `make open` requires macOS Apple Silicon. Sources load directly; Host helpers and pinned released dependencies in `gams.json` are not bundled.

| Command | Purpose |
| --- | --- |
| `make open` | Open local Project in released Host; first launch needs network. |
| `make check` | Check JavaScript syntax. |
| `make package` | Build stable-name ZIP and SHA256SUMS under `build.nosync/`. |
| `make serve-docs` | Preview pinned wiki; `DOCS_PORT=8081` overrides port 8080. |
| `make docs` | Build portable wiki in `build.nosync/site/`. |
| `make validate-docs` | Validate wiki links/content. |
| `make clean` | Remove build output and marked downloads; refuse tracked files, symlinks and supplied tools/Units. |

Existing Host tools are never implicitly updated. Keep macOS security checks intact. GUI verification of XML compiler/runtime parity, generation cancellation and voxel/canvas rendering remains pending.
