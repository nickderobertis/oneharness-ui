# macOS workflow policy

`macos-policy.mjs classify --event PATH --base REF --head REF` is the production
routing surface. GitHub supplies `GITHUB_EVENT_NAME`; subprocess fixtures put
`event_name` in their event documents. Missing/unreadable event documents default
to a PR unless GitHub identifies a non-PR event. Every PR requires the sequential
Mac gate, installer preparation, DMG mount/install, application executable and
bridge `INVALID_REQUEST` JSON assertions. Linux carriers preserve the exact
protected `check (macos-15)` and `macos-native-smoke` names and reject failed,
cancelled, skipped or missing required work.

The manager's task-specific ruling is that this repository tags releases directly
with semantic-release and opens no release PR. There is no authorized release-PR
identity or branch. Accordingly `isReleaseOnly` is always false: bot identity,
release-shaped branch/title and version-only content cannot authorize omission.
The classifier retains the agreed arguments without inventing an automation
agreement. Non-PR events do not request the CI Mac lane. A manually opted-in
`macos_diagnostic` in `check.yml` is separate from the automatic lifecycle and
its default is false. Automatic artifact dispatch supplies only `release_tag`.

The private `.github` package is a member of the root Bun workspace and uses only
`bun.lock`; the manager accepted the resulting shared-input change. Its three
dependencies are the YAML parser, published Actions evaluator and budget SDK.

The release build retains Linux x86_64/ARM64 deb and AppImage, macOS ARM64 app/DMG,
and Windows x86_64 MSI/NSIS production. `scripts/release-assets.mjs` remains the
canonical published asset inventory; `.app` remains a built bundle, as before.
Historical tags may predate the verifier command. The Mac release job keeps
package production on the verified tag and sparsely checks out verifier commands
from `github.workflow_sha` afterward; verification still precedes asset staging.
Native builders stage checksummed assets; a Linux job downloads artifacts from
that same workflow run and publishes only after every platform build succeeds.
Tag verification, detached source checkout, set-version, seed and semantic-release
semantics remain in their existing commands. The Mac mount/install/bridge proof
runs before the build hands assets to publication. Linux ARM64 public smoke waits
for publication and never requests Mac.

`github-workflows:test` installs the locked Bun workspace, including this private tooling package and runs
`node --test .github/tests/*.test.mjs`. It reads the actual workflow files, expands
matrices, evaluates conditions with `@actions/expressions`, and records ignored
`.telemetry/macos-policy.json`. Test caching is disabled. Telemetry names workflow,
event, ownership/diff scenario, runner and target, and carries a digest of its workflow/tooling inputs. Budget registrations are
excluded from that digest so the analysis commands never read cost limits.
The lifecycle is one PR push, its main merge, tag and artifact dispatch and
all downstream events. Release-shaped PR cases are adversarial classification
fixtures, not a second PR introduced by this repository's release automation.

The visual-docs reusable call is pinned to
`4bacdb8b8ad407f775cfade4697bbe02de1d316f`. Its exact upstream YAML body is stored under
`reusable-workflows/` with a local fixture annotation outside the upstream body. The resolver checks
the body against its locked digest before parsing or execution. Offline
resolution traverses its real jobs and executes
its actual matrix-producing shell command with the installed `screencomp` CLI.
Refresh this source and the pinned call together when upgrading; unresolved calls,
runners, expressions or matrix producers are errors. The graph proof accounts for
both affected and unaffected routing through existing focused workflow tests;
visual capture is evaluated selected to expose all possible nested runners.

The resolver executes the production classifier-output adapter and resolves the
workflow-declared output expressions, so renamed or missing output wiring fails
the contract. Parsed workflow/matrix/telemetry boundaries are validated, and
unsupported or duplicate producer architecture lanes fail explicitly. Helper
JavaScript receives TypeScript checking through the root pinned compiler.

`github-workflows:budgets` depends on the recording test and uses onebudgetspec
through its SDK. The two analysis commands read recorded telemetry and report
measurements through `report`; only onebudgetspec compares the approved thresholds.
They reject stale/missing telemetry and do not rerun scenarios. The affected merge
path selects this project and its budgets for workflow/tooling inputs; native
packaging stays behind the existing desktop packaging edge.
