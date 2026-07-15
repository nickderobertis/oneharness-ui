set dotenv-load := false
set shell := ["bash", "-cu"]
set windows-shell := ["sh", "-cu"]

default:
    @echo "Run 'just --list' to see available commands."

bootstrap:
    @./scripts/run-quiet.sh "bootstrap" "Install the pinned tools in .tool-versions, then rerun 'just bootstrap'." -- ./scripts/bootstrap.sh

dev:
    @bunx tauri dev --config apps/desktop-shell/tauri.conf.json

check: format-check lint typecheck test build supply-chain

gate:
    @if [ -n "${NX_BASE:-}" ]; then just check-affected; else just check; fi

check-affected:
    @[[ "${NX_BASE:-}" =~ ^[0-9a-f]{40}$ && "${NX_HEAD:-}" =~ ^([0-9a-f]{40}|HEAD)$ ]] || { echo "affected checks: NX_BASE must be a commit SHA and NX_HEAD must be a commit SHA or HEAD" >&2; exit 2; }
    @./scripts/run-quiet.sh "affected checks" "Fix the reported affected-project findings, then rerun the shared gate with the same NX_BASE and NX_HEAD." -- env RUSTFLAGS="-D warnings" bunx nx affected -t format-check lint typecheck test build e2e --base="$NX_BASE" --head="$NX_HEAD" --outputStyle=static
    @files=(coverage/*/lcov.info); if [ -e "${files[0]}" ]; then ./scripts/run-quiet.sh "affected coverage" "Add user-facing tests for the uncovered authored code, then rerun the affected gate." -- node scripts/check-coverage.mjs "${files[@]}"; fi
    @./scripts/run-quiet.sh "import boundaries" "Restore the documented package import direction, then rerun 'just lint'." -- node scripts/check-boundaries.mjs
    @./scripts/run-quiet.sh "shell lint" "Fix the reported shell diagnostics, then rerun 'just lint'." -- uvx --from shellcheck-py==0.11.0.1 shellcheck scripts/*.sh
    @./scripts/run-quiet.sh "workflow lint" "Fix the reported workflow diagnostics, then rerun 'just lint'." -- uvx --from actionlint-py==1.7.12.24 actionlint .github/workflows/*.yml
    @just supply-chain

format:
    @./scripts/run-quiet.sh "format" "Resolve the formatter error, then rerun 'just format'." -- bunx nx run-many -t format --all --parallel=1 --outputStyle=static

format-check:
    @./scripts/run-quiet.sh "format check" "Run 'just format', review the changes, and rerun 'just format-check'." -- bunx nx run-many -t format-check --all --outputStyle=static

lint:
    @./scripts/run-quiet.sh "workspace lint" "Fix the reported lint findings, then rerun 'just lint'." -- bunx nx run-many -t lint --all --outputStyle=static
    @./scripts/run-quiet.sh "shell lint" "Fix the reported shell diagnostics, then rerun 'just lint'." -- uvx --from shellcheck-py==0.11.0.1 shellcheck scripts/*.sh
    @./scripts/run-quiet.sh "workflow lint" "Fix the reported workflow diagnostics, then rerun 'just lint'." -- uvx --from actionlint-py==1.7.12.24 actionlint .github/workflows/*.yml

typecheck:
    @./scripts/run-quiet.sh "typecheck" "Fix the reported TypeScript or Rust diagnostics, then rerun 'just typecheck'." -- env RUSTFLAGS="-D warnings" bunx nx run-many -t typecheck --all --outputStyle=static

# Nx project tests enforce Bun coverage thresholds and cargo llvm-cov --fail-under-lines 95.
test:
    @./scripts/run-quiet.sh "tests" "Fix the reported test failure, then rerun 'just test'." -- bunx nx run-many -t test --all --outputStyle=static
    @./scripts/run-quiet.sh "authored coverage" "Add user-facing tests for uncovered authored code, then rerun 'just test'." -- node scripts/check-coverage.mjs coverage/ipc-contract/lcov.info coverage/oneharness-bridge/lcov.info coverage/conversation-ui/lcov.info
    @just test-e2e

test-e2e:
    @./scripts/run-quiet.sh "browser journeys" "Inspect the Playwright artifact, fix the user journey, and rerun 'just test-e2e'." -- bunx nx run conversation-ui:e2e --outputStyle=static

build:
    @./scripts/run-quiet.sh "build" "Fix the reported static-export or native build error, then rerun 'just build'." -- env RUSTFLAGS="-D warnings" bunx nx run-many -t build --all --outputStyle=static

bundle bundles:
    @./scripts/run-quiet.sh "native {{ bundles }} bundle" "Install the platform's Tauri prerequisites, fix the reported packaging error, and rerun this command." -- bunx tauri build --config apps/desktop-shell/tauri.conf.json --bundles "{{ bundles }}"

checksums directory output:
    @./scripts/run-quiet.sh "release checksums" "Build the platform bundles first, then rerun this command with their directory." -- bun scripts/checksums.mjs "{{ directory }}" "{{ output }}"

set-version version:
    @./scripts/run-quiet.sh "version manifests" "Fix the reported manifest or lockfile error, then rerun this command." -- bun scripts/set-version.mjs "{{ version }}"

publish-release:
    @bunx semantic-release

supply-chain:
    @./scripts/run-quiet.sh "Rust dependency policy" "Resolve the reported license, advisory, source, or ban finding, then rerun 'just supply-chain'." -- cargo deny check --hide-inclusion-graph
    @./scripts/run-quiet.sh "Rust dependency usage" "Remove or correctly declare the reported dependency, then rerun 'just supply-chain'." -- cargo machete
    @./scripts/run-quiet.sh "JavaScript dependency audit" "Upgrade or replace the vulnerable dependency, then rerun 'just supply-chain'." -- bun audit --audit-level=high

upgrade:
    @./scripts/run-quiet.sh "pinned SDK refresh" "Verify network access and the immutable SDK pin, then rerun 'just upgrade'." -- ./scripts/fetch-sdk.sh
    @./scripts/run-quiet.sh "JavaScript dependency upgrade" "Resolve the package conflict, then rerun 'just upgrade'." -- bun update
    @./scripts/run-quiet.sh "Rust dependency upgrade" "Resolve the Cargo dependency conflict, then rerun 'just upgrade'." -- cargo update
    @just gate

setup-llmlint:
    @./scripts/run-quiet.sh "llmlint setup" "Install uv and authenticate a configured harness, then rerun 'just setup-llmlint'." -- ./scripts/setup-llmlint.sh

session-setup:
    @./scripts/run-quiet.sh "agent session setup" "Install the missing pinned tool reported above, then rerun 'just session-setup'." -- ./scripts/session-setup.sh

lint-llm *args:
    @command -v llmlint >/dev/null 2>&1 || { echo "llmlint missing; run just setup-llmlint" >&2; exit 1; }
    @llmlint {{ args }}

lint-llm-diff *args:
    @command -v llmlint >/dev/null 2>&1 || { echo "llmlint missing; run just setup-llmlint" >&2; exit 1; }
    @llmlint --diff --diff-base "origin/main" {{ args }}

lint-llm-validate *args:
    @command -v llmlint >/dev/null 2>&1 || { echo "llmlint missing; run just setup-llmlint" >&2; exit 1; }
    @llmlint validate {{ args }}
