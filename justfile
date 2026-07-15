set dotenv-load := false
set shell := ["bash", "-cu"]

default:
  @just --list

bootstrap:
  @./scripts/bootstrap.sh

check: format-check lint typecheck test build supply-chain

gate: check

format:
  @bunx biome format --write .
  @cargo fmt --all

format-check:
  @bunx nx run-many -t format-check --all --outputStyle=static

lint:
  @bunx nx run-many -t lint --all --outputStyle=static
  @node scripts/check-boundaries.mjs
  @shellcheck scripts/*.sh

typecheck:
  @bunx nx run-many -t typecheck --all --outputStyle=static

test:
  @bunx nx run-many -t test --all --outputStyle=static
  @just test-e2e

test-e2e:
  @bunx nx run conversation-ui:e2e --outputStyle=static

build:
  @bunx nx run-many -t build --all --outputStyle=static

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
