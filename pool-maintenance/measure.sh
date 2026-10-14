#!/usr/bin/env bash
# Measures oneharness-ui-pool-maintenance-seconds (budgets.yaml): one steady-state
# pass of the declared `just pool-maintenance`, after one run's worth of new
# superseded builds. It really prunes and builds this checkout's target dir.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT

fail() {
  printf 'pool maintenance budget: %s\n' "$1" >&2
  exit 1
}

[ -n "${ONEBUDGETSPEC_RESULT:-}" ] \
  || fail "ONEBUDGETSPEC_RESULT is unset; run 'bunx nx run pool-maintenance:budgets-host' so onebudgetspec judges the figure"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/oneharness-ui-pool-maintenance.XXXXXX")"
readonly WORK
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT"

# Every build entry the pruner judges: the children of each profile directory's
# deps/, .fingerprint/, build/ and incremental/, named by their metadata hash.
list_entries() {
  find target -mindepth 3 -maxdepth 4 \
    \( -path '*/deps/*' -o -path '*/.fingerprint/*' -o -path '*/build/*' -o -path '*/incremental/*' \) \
    -prune -print 2>/dev/null | LC_ALL=C sort
}

# The test targets the gate builds (its Windows lane builds exactly these without running them).
build_tests() {
  local label="$1"
  shift
  "$@" cargo test --locked --workspace --all-features --no-run >"$WORK/build.log" 2>&1 || {
    cat "$WORK/build.log" >&2
    fail "the $label test build failed; fix the cargo diagnostic above, then rerun the budget"
  }
}

result_field() {
  node -e 'const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(String(r[process.argv[2]]));' "$1" "$2"
}

# (a) Clear any older backlog, untimed: its seconds are evidence, never the figure.
ONEBUDGETSPEC_RESULT="$WORK/backlog.json" just pool-maintenance >/dev/null \
  || fail "the backlog pass of 'just pool-maintenance' failed; fix the error above, then rerun the budget"
backlog_seconds="$(result_field "$WORK/backlog.json" value)"

# (b) One run's builds under another dev-profile debuginfo level, which gives every
# crate new metadata hashes, backdated past the 2-day window so they stand in for a
# run's builds that have since been superseded. The date predates every ordinary
# build, so each unit's newest build stays the ordinary one.
list_entries >"$WORK/before-alternative.txt"
build_tests "alternative-configuration" env CARGO_PROFILE_DEV_DEBUG=line-tables-only
list_entries >"$WORK/after-alternative.txt"
LC_ALL=C comm -13 "$WORK/before-alternative.txt" "$WORK/after-alternative.txt" >"$WORK/alternative.txt"
[ -s "$WORK/alternative.txt" ] \
  || fail "the alternative-configuration build created no build entries, so the pass would have nothing superseded to remove; make sure .cargo/config.toml does not already set the dev profile's debug to line-tables-only, then rerun the budget"
while IFS= read -r entry; do
  find "$entry" -exec touch -h -d '2000-01-01T00:00:00Z' {} +
done <"$WORK/alternative.txt"

# (c) The ordinary gate build, so each unit's newest build is the ordinary one.
build_tests "ordinary" env
list_entries | LC_ALL=C comm -23 - "$WORK/alternative.txt" >"$WORK/ordinary-before.txt"

# (d) The timed pass: the figure is this pass alone, as the pruner reports it.
ONEBUDGETSPEC_RESULT="$WORK/timed.json" just pool-maintenance \
  || fail "the timed pass of 'just pool-maintenance' failed; fix the error above, then rerun the budget"
list_entries >"$WORK/after-pass.txt"
LC_ALL=C comm -12 "$WORK/alternative.txt" "$WORK/after-pass.txt" >"$WORK/alternative-left.txt"
LC_ALL=C comm -23 "$WORK/ordinary-before.txt" "$WORK/after-pass.txt" >"$WORK/ordinary-lost.txt"
if [ -s "$WORK/ordinary-lost.txt" ]; then
  cat "$WORK/ordinary-lost.txt" >&2
  fail "the pass removed the ordinary build entries listed above, superseded by a rebuild in the ordinary step; run 'cargo test --locked --workspace --all-features --no-run' and 'just pool-maintenance' once to settle the target dir, then rerun the budget"
fi
if [ -n "${POOL_MAINTENANCE_EVIDENCE_DIR:-}" ]; then
  mkdir -p "$POOL_MAINTENANCE_EVIDENCE_DIR"
  cp "$WORK/alternative.txt" "$WORK/alternative-left.txt" "$WORK/ordinary-before.txt" "$POOL_MAINTENANCE_EVIDENCE_DIR/"
  cp "$WORK/after-pass.txt" "$POOL_MAINTENANCE_EVIDENCE_DIR/after-pass.txt"
fi

# shellcheck disable=SC2016 # The single-quoted program is JavaScript; node expands its template literal.
node -e '
const fs = require("node:fs");
const [timed, out, backlog, created, left, ordinary] = process.argv.slice(1);
const result = JSON.parse(fs.readFileSync(timed, "utf8"));
result.detail = `${result.detail}; alternative build entries created: ${created}, left after the pass: ${left}; ordinary build entries kept: ${ordinary} of ${ordinary}; untimed backlog pass seconds (not counted): ${backlog}`;
fs.writeFileSync(out, JSON.stringify(result));
' "$WORK/timed.json" "$ONEBUDGETSPEC_RESULT" "$backlog_seconds" \
  "$(wc -l <"$WORK/alternative.txt" | tr -d ' ')" "$(wc -l <"$WORK/alternative-left.txt" | tr -d ' ')" \
  "$(wc -l <"$WORK/ordinary-before.txt" | tr -d ' ')"
