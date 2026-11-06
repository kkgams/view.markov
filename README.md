# view.markov

One separately installable ZIP per View, never npm/OCI. Host contract: GAMS 2.0.3.
Run npm test (Node 24, Python 3 stdlib). release.json binds package identities, deployment maps and hashes.
Absolute imports enumerated in release.json are required Host-owned runtime/util/widget APIs; missing APIs, config or schemas are bugs, not optional fallbacks.
Keep Project Config ids/tags and URLs as deployed. view-markdow spelling is deliberately unchanged.
Blend 1D retains views/view-animation-blend-spaces.js; independently installed 2D requires views/view-animation-blend-space-2d.js in Project Config. No HTML/class behavior is rewritten.
Install using scripts/release.py install (verified checksums), retain metadata under notices/project-units/<package>. Refuse all overwrite collisions.
Dependencies (plugins, sibling Views, UI Services) remain Project configured; static Host imports are documented, not vendored.
HOST-CONTRACT.json includes required dynamic widget paths and known legacy schema limits.
GUI validation pending: XML compiler/runtime parity, generation cancellation and voxel/canvas rendering. No blanket E2E claim.

## Release authorization

A pushed matching version tag authorizes publication from any branch. No manual
checksum approval variables are required; source/evidence and artifact checks remain
strict. See `PUBLISHING.md`.

## Local Project and documentation

Requires Node.js 24+, Python 3, Make, curl, tar and unzip. On macOS Apple Silicon:

```sh
make open            # check source and open this repository's gams.json
make serve-docs      # http://localhost:8080; DOCS_PORT overrides
make validate-docs
make docs            # portable documentation under build/site/
```

`make open` downloads the released Host into ignored `tools/gams.app` when absent,
retains its notices in `tools/gams-release-notices/`, and explicitly sets
`GAMS_APP_CWD`. It never updates an existing app implicitly or bypasses Gatekeeper.
The Project uses local canonical View source; no sibling checkout is needed.
First startup installs pinned released dependencies into ignored `gams_modules/`
and requires network access. Source-only Views need no compilation; `make build`
checks JavaScript syntax and local Project entry paths before launch.

Documentation uses pinned justgook/wiki v1.4.0, with downloaded engine and output
under ignored `build/`. `build-docs` remains an alias. Every push to `release`
publishes via `make docs`, independently of version tags; select GitHub Actions
as the repository's Pages source. A pushed matching version tag authorizes the Unit release from any branch.
