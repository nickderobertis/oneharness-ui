set dotenv-load := false
set shell := ["bash", "-cu"]
set windows-shell := ["sh", "-cu"]

default:
  @just --list

bootstrap:
  @./scripts/bootstrap.sh

check: format-check lint typecheck test build supply-chain

gate: check

check-affected base head:
  @bunx nx affected -t format-check lint typecheck test build e2e --base={{base}} --head={{head}} --outputStyle=static
  @files=(coverage/*/lcov.info); if [ -e "${files[0]}" ]; then node scripts/check-coverage.mjs "${files[@]}"; fi
  @node scripts/check-boundaries.mjs
  @uvx --from shellcheck-py==0.11.0.1 shellcheck scripts/*.sh
  @uvx --from actionlint-py==1.7.12.24 actionlint .github/workflows/*.yml
  @just supply-chain

format:
  @bunx nx run-many -t format --all --parallel=1 --outputStyle=static

format-check:
  @bunx nx run-many -t format-check --all --outputStyle=static

lint:
  @bunx nx run-many -t lint --all --outputStyle=static
  @uvx --from shellcheck-py==0.11.0.1 shellcheck scripts/*.sh
  @uvx --from actionlint-py==1.7.12.24 actionlint .github/workflows/*.yml

typecheck:
  @RUSTFLAGS="-D warnings" bunx nx run-many -t typecheck --all --outputStyle=static

# Nx project tests enforce Bun coverage thresholds and cargo llvm-cov --fail-under-lines 95.
test:
  @bunx nx run-many -t test --all --outputStyle=static
  @node scripts/check-coverage.mjs coverage/ipc-contract/lcov.info coverage/oneharness-bridge/lcov.info coverage/conversation-ui/lcov.info
  @just test-e2e

test-e2e:
  @bunx nx run conversation-ui:e2e --outputStyle=static

build:
  @RUSTFLAGS="-D warnings" bunx nx run-many -t build --all --outputStyle=static

supply-chain:
  @cargo deny check --hide-inclusion-graph
  @cargo machete
  @bun audit --audit-level=high

upgrade:
  @./scripts/fetch-sdk.sh
  @bun update
  @cargo update
  @just check

setup-llmlint:
  @./scripts/setup-llmlint.sh

session-setup:
  @./scripts/session-setup.sh

lint-llm *args:
  @command -v llmlint >/dev/null 2>&1 || { echo "llmlint missing; run just setup-llmlint" >&2; exit 1; }
  @llmlint {{args}}

lint-llm-diff *args:
  @command -v llmlint >/dev/null 2>&1 || { echo "llmlint missing; run just setup-llmlint" >&2; exit 1; }
  @llmlint --diff --diff-base "origin/main" {{args}}

lint-llm-validate *args:
  @command -v llmlint >/dev/null 2>&1 || { echo "llmlint missing; run just setup-llmlint" >&2; exit 1; }
  @llmlint validate {{args}}
