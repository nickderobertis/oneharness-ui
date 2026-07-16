set dotenv-load := false
set shell := ["bash", "-cu"]
set windows-shell := ["sh", "-cu"]

default:
    @echo "Run 'just --list' to see available commands."

bootstrap:
    @./scripts/run-quiet.sh "bootstrap" "Install the pinned tools in .tool-versions, then rerun 'just bootstrap'." -- ./scripts/bootstrap.sh

dev:
    @./scripts/run-quiet.sh "desktop development session" "Install the platform's Tauri prerequisites, fix the reported startup error, and rerun 'just dev'." -- bunx tauri dev --config apps/desktop-shell/tauri.conf.json

check:
    @ONEHARNESS_QUIET=1 just format-check
    @ONEHARNESS_QUIET=1 just lint
    @ONEHARNESS_QUIET=1 just typecheck
    @ONEHARNESS_QUIET=1 just test
    @ONEHARNESS_QUIET=1 just build
    @ONEHARNESS_QUIET=1 just supply-chain
    @if [ "${ONEHARNESS_QUIET:-}" != "1" ]; then echo "check: ok"; fi

gate:
    @if [ -n "${NX_BASE:-}" ]; then ONEHARNESS_QUIET=1 just check-affected; else ONEHARNESS_QUIET=1 just check; fi
    @if [ "${ONEHARNESS_QUIET:-}" != "1" ]; then echo "gate: ok"; fi

check-affected:
    @[[ "${NX_BASE:-}" =~ ^[0-9a-f]{40}$ && "${NX_HEAD:-}" =~ ^([0-9a-f]{40}|HEAD)$ ]] || { echo "affected checks: NX_BASE must be a commit SHA and NX_HEAD must be a commit SHA or HEAD" >&2; exit 2; }
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "affected checks" "Fix the reported affected-project findings, then rerun the shared gate with the same NX_BASE and NX_HEAD." -- env RUSTFLAGS="-D warnings" bunx nx affected -t format-check lint typecheck test build e2e --base="$NX_BASE" --head="$NX_HEAD" --outputStyle=static
    @files=(coverage/*/lcov.info); if [ -e "${files[0]}" ]; then ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "affected coverage" "Add user-facing tests for the uncovered authored code, then rerun the affected gate." -- node scripts/check-coverage.mjs "${files[@]}"; fi
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "import boundaries" "Restore the documented package import direction, then rerun 'just lint'." -- node scripts/check-boundaries.mjs
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "shell lint" "Fix the reported shell diagnostics, then rerun 'just lint'." -- uvx --from shellcheck-py==0.11.0.1 shellcheck scripts/*.sh
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "workflow lint" "Fix the reported workflow diagnostics, then rerun 'just lint'." -- uvx --from actionlint-py==1.7.12.24 actionlint .github/workflows/*.yml
    @ONEHARNESS_QUIET=1 just supply-chain
    @if [ "${ONEHARNESS_QUIET:-}" != "1" ]; then echo "affected gate: ok"; fi

format:
    @./scripts/run-quiet.sh "format" "Resolve the formatter error, then rerun 'just format'." -- bunx nx run-many -t format --all --parallel=1 --outputStyle=static

format-check:
    @./scripts/run-quiet.sh "format check" "Run 'just format', review the changes, and rerun 'just format-check'." -- bunx nx run-many -t format-check --all --outputStyle=static

lint:
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "workspace lint" "Fix the reported lint findings, then rerun 'just lint'." -- bunx nx run-many -t lint --all --outputStyle=static
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "shell lint" "Fix the reported shell diagnostics, then rerun 'just lint'." -- uvx --from shellcheck-py==0.11.0.1 shellcheck scripts/*.sh
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "workflow lint" "Fix the reported workflow diagnostics, then rerun 'just lint'." -- uvx --from actionlint-py==1.7.12.24 actionlint .github/workflows/*.yml
    @if [ "${ONEHARNESS_QUIET:-}" != "1" ]; then echo "lint: ok"; fi

typecheck:
    @./scripts/run-quiet.sh "typecheck" "Fix the reported TypeScript or Rust diagnostics, then rerun 'just typecheck'." -- env RUSTFLAGS="-D warnings" bunx nx run-many -t typecheck --all --outputStyle=static

# Nx project tests enforce Bun coverage thresholds and cargo llvm-cov --fail-under-lines 95.
test:
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "tests" "Fix the reported test failure, then rerun 'just test'." -- env RUSTFLAGS="-D warnings" bunx nx run-many -t test --all --outputStyle=static
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "authored coverage" "Add user-facing tests for uncovered authored code, then rerun 'just test'." -- node scripts/check-coverage.mjs coverage/ipc-contract/lcov.info coverage/oneharness-bridge/lcov.info coverage/conversation-ui/lcov.info
    @ONEHARNESS_QUIET=1 just test-e2e
    @if [ "${ONEHARNESS_QUIET:-}" != "1" ]; then echo "test: ok"; fi

test-e2e:
    @./scripts/run-quiet.sh "browser journeys" "Inspect the Playwright artifact, fix the user journey, and rerun 'just test-e2e'." -- bunx nx run conversation-ui:e2e --outputStyle=static

# Packages and drives the real desktop binary with official tauri-driver. Upstream supports Linux and Windows only.
test-desktop-e2e:
    @./scripts/run-quiet.sh "native desktop journey" "Install the documented WebDriver prerequisite, inspect test-results/desktop-e2e, and rerun 'just test-desktop-e2e'." -- env RUSTFLAGS="-D warnings" bunx nx run desktop-shell:desktop-e2e --outputStyle=static

build:
    @./scripts/run-quiet.sh "build" "Fix the reported static-export or native build error, then rerun 'just build'." -- env RUSTFLAGS="-D warnings" bunx nx run-many -t build --all --outputStyle=static

bundle:
    @[[ "${BUNDLE_FORMATS:-}" =~ ^(deb|appimage|app|dmg|msi|nsis)(,(deb|appimage|app|dmg|msi|nsis))*$ ]] || { echo "native bundle: set BUNDLE_FORMATS to a comma-separated platform bundle list" >&2; exit 2; }
    @./scripts/run-quiet.sh "native bundle" "Install the platform's Tauri prerequisites, fix the reported packaging error, and rerun 'just bundle'." -- bun scripts/build-native.mjs "$BUNDLE_FORMATS"

checksums:
    @./scripts/run-quiet.sh "release checksums" "Set BUNDLE_DIRECTORY and CHECKSUM_OUTPUT after building the platform bundles, then rerun 'just checksums'." -- bun scripts/checksums.mjs "${BUNDLE_DIRECTORY:-}" "${CHECKSUM_OUTPUT:-}"

set-version:
    @./scripts/run-quiet.sh "version manifests" "Set RELEASE_VERSION to a valid semver, fix any reported manifest error, and rerun 'just set-version'." -- bun scripts/set-version.mjs "${RELEASE_VERSION:-}"

publish-release:
    @./scripts/run-quiet.sh "semantic release" "Verify the protected-main history and built-in GitHub token permissions, then rerun 'just publish-release'." -- bunx semantic-release

seed-release:
    @./scripts/run-quiet.sh "initial release seed" "Verify GITHUB_SHA and built-in GitHub token permissions, then rerun 'just seed-release'." -- ./scripts/seed-release.sh

dispatch-release:
    @./scripts/run-quiet.sh "release dispatch" "Verify RELEASE_TAG and built-in GitHub token permissions, then rerun 'just dispatch-release'." -- ./scripts/dispatch-release.sh

upload-release:
    @./scripts/run-quiet.sh "native release upload" "Verify the built-in GH_TOKEN and validated release environment, then rerun 'just upload-release'." -- ./scripts/upload-release.sh

supply-chain:
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "Rust dependency policy" "Resolve the reported license, advisory, source, or ban finding, then rerun 'just supply-chain'." -- cargo deny check --hide-inclusion-graph
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "Rust dependency usage" "Remove or correctly declare the reported dependency, then rerun 'just supply-chain'." -- cargo machete
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "JavaScript dependency audit" "Upgrade or replace the vulnerable dependency, then rerun 'just supply-chain'." -- bun audit --audit-level=high
    @if [ "${ONEHARNESS_QUIET:-}" != "1" ]; then echo "supply-chain: ok"; fi

upgrade:
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "pinned SDK refresh" "Verify network access and the immutable SDK pin, then rerun 'just upgrade'." -- ./scripts/fetch-sdk.sh
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "JavaScript dependency upgrade" "Resolve the package conflict, then rerun 'just upgrade'." -- bun update
    @ONEHARNESS_QUIET=1 ./scripts/run-quiet.sh "Rust dependency upgrade" "Resolve the Cargo dependency conflict, then rerun 'just upgrade'." -- cargo update
    @ONEHARNESS_QUIET=1 just gate
    @if [ "${ONEHARNESS_QUIET:-}" != "1" ]; then echo "upgrade: ok"; fi

setup-llmlint:
    @./scripts/run-quiet.sh "llmlint setup" "Install uv and authenticate a configured harness, then rerun 'just setup-llmlint'." -- ./scripts/setup-llmlint.sh

session-setup:
    @./scripts/run-quiet.sh "agent session setup" "Install the missing pinned tool reported above, then rerun 'just session-setup'." -- ./scripts/session-setup.sh

lint-llm:
    @command -v llmlint >/dev/null 2>&1 || { echo "llmlint missing; run just setup-llmlint" >&2; exit 1; }
    @./scripts/run-quiet.sh "semantic lint" "Inspect 'llmlint history latest', fix every finding, then rerun 'just lint-llm'." -- llmlint

lint-llm-diff:
    @command -v llmlint >/dev/null 2>&1 || { echo "llmlint missing; run just setup-llmlint" >&2; exit 1; }
    @./scripts/run-quiet.sh "semantic diff lint" "Inspect 'llmlint history latest', fix every finding, then rerun 'just lint-llm-diff'." -- llmlint --diff --diff-base "origin/main"

lint-llm-copilot:
    @./scripts/run-llmlint-copilot.sh

[positional-arguments]
lint-llm-validate *args:
    @command -v llmlint >/dev/null 2>&1 || { echo "llmlint missing; run just setup-llmlint" >&2; exit 1; }
    @./scripts/run-quiet.sh "semantic lint configuration" "Correct llmlint.yml or its rule references, then rerun 'just lint-llm-validate'." -- llmlint validate "$@"
