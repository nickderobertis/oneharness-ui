# Windows desktop WebDriver startup review

Reviewed read-only: every completed `desktop-e2e` workflow run created from
2026-10-06T00:00:00Z through 2026-10-13T16:00:00Z: 22 runs and 23 `desktop-e2e (windows-2025)` jobs, because
run 38418554958 has two attempts. The set and every attempt's jobs were
reconciled from the workflow-runs and per-attempt jobs APIs after all of them
settled, and every Windows job log was read; this dispatch did not re-run,
cancel or modify CI. The inventory includes Windows jobs only. Successful native-journey commands
prove the tests ran; selection-only successes do not. The original 11-of-13
workflow-success figure counted selection skips, so it was not a journey pass rate.

| Run created (UTC) | Run | Windows job | Pre-test outcome |
| --- | --- | --- | --- |
| 2026-10-07T12:38:05Z | [37622408684](https://github.com/nickderobertis/oneharness-ui/actions/runs/37622408684) | 112795677648 | Cancelled during the native-journey step (see below); whether it reached the first test is not recorded |
| 2026-10-07T12:57:49Z | [37624826420](https://github.com/nickderobertis/oneharness-ui/actions/runs/37624826420) | 112804306181 | Cancelled during bootstrap, before the native-journey step |
| 2026-10-07T13:11:00Z | [37626505068](https://github.com/nickderobertis/oneharness-ui/actions/runs/37626505068) | 112809847822 | Reached first test; native journey passed |
| 2026-10-07T13:39:35Z | [37630257653](https://github.com/nickderobertis/oneharness-ui/actions/runs/37630257653) | 112822352911 | Reached first test; native journey passed |
| 2026-10-07T14:04:49Z | [37633708173](https://github.com/nickderobertis/oneharness-ui/actions/runs/37633708173) | 112834910760 | Reached first test; native journey passed |
| 2026-10-07T15:18:07Z | [37642733617](https://github.com/nickderobertis/oneharness-ui/actions/runs/37642733617) | 112866103787 | Reached first test; native journey passed |
| 2026-10-07T16:33:26Z | [37652973648](https://github.com/nickderobertis/oneharness-ui/actions/runs/37652973648) | 112900808575 | Reached first test; native journey passed |
| 2026-10-07T16:35:58Z | [37653306216](https://github.com/nickderobertis/oneharness-ui/actions/runs/37653306216) | 112901950847 | Skipped by affected selection; no native journey |
| 2026-10-12T11:26:43Z | [38242684475](https://github.com/nickderobertis/oneharness-ui/actions/runs/38242684475) | 114788912063 | Skipped by affected selection; no native journey |
| 2026-10-12T15:28:52Z | [38270546276](https://github.com/nickderobertis/oneharness-ui/actions/runs/38270546276) | 114883436748 | Reached first test; native journey passed |
| 2026-10-12T15:54:38Z | [38273635429](https://github.com/nickderobertis/oneharness-ui/actions/runs/38273635429) | 114893715403 | Reached first test; native journey passed |
| 2026-10-12T19:18:52Z | [38296817006](https://github.com/nickderobertis/oneharness-ui/actions/runs/38296817006) | 114969771382 | Reached first test; native journey passed |
| 2026-10-12T20:57:14Z | [38307532561](https://github.com/nickderobertis/oneharness-ui/actions/runs/38307532561) | 115005097723 | Reached first test; native journey passed |
| 2026-10-12T21:40:32Z | [38312105468](https://github.com/nickderobertis/oneharness-ui/actions/runs/38312105468) | 115020031661 | Reached first test; native journey passed |
| 2026-10-13T02:38:49Z | [38337865883](https://github.com/nickderobertis/oneharness-ui/actions/runs/38337865883) | 115101960193 | Reached first test; native journey passed |
| 2026-10-13T03:03:35Z | [38339878803](https://github.com/nickderobertis/oneharness-ui/actions/runs/38339878803) | 115108240330 | Reached first test; native journey passed |
| 2026-10-13T07:59:17Z | [38366216502](https://github.com/nickderobertis/oneharness-ui/actions/runs/38366216502) | 115191874807 | Reached first test; native journey passed |
| 2026-10-13T11:07:50Z | [38388089103](https://github.com/nickderobertis/oneharness-ui/actions/runs/38388089103) | 115264740035 | Reached first test; native journey passed |
| 2026-10-13T11:46:20Z | [38392525109](https://github.com/nickderobertis/oneharness-ui/actions/runs/38392525109) | 115279555940 | Reached first test; native journey passed |
| 2026-10-13T12:26:41Z | [38397324626](https://github.com/nickderobertis/oneharness-ui/actions/runs/38397324626) | 115295762405 | Reached first test; native journey passed |
| 2026-10-13T12:29:18Z | [38397642975](https://github.com/nickderobertis/oneharness-ui/actions/runs/38397642975) | 115296848060 | Skipped by affected selection; no native journey |
| 2026-10-13T15:02:10Z | [38418554958](https://github.com/nickderobertis/oneharness-ui/actions/runs/38418554958) | 115369401264 | Failed before first test: msedgedriver download failed; service continued, then 10-second tauri-driver readiness timeout |
| 2026-10-13T15:02:10Z | [38418554958, attempt 2](https://github.com/nickderobertis/oneharness-ui/actions/runs/38418554958) | 115406088574 | Reached first test; native journey passed on the unchanged PR head |

Rows were classified from each job's steps and log. A successful journey step
prints `native desktop journey: ok`; selection-skipped jobs show the selection
step succeeding and the bootstrap and journey steps skipped. Both cancellations
came from the workflow's `cancel-in-progress` concurrency group when a newer run
on the same branch started: job 112804306181 was cancelled at 13:11:41Z, during
bootstrap, after run 37626505068 was created at 13:11:00Z. Job 112795677648 was
cancelled at 12:58:20Z, after run 37624826420 was created at 12:57:49Z, while the
Windows journey step had been running for 7m47s. That step was cancelled with
exit -1073741510 (0xC000013A, console control exit) and printed no driver or
WebDriver error. Successful Windows journey steps in the same branch took
7m09s to 9m59s, so the log cannot show whether it stopped before or after the
first test, and the run uploaded no artifact. It is not counted as a driver failure.

The journey's output is quiet on success and only run 38418554958 uploaded a
Windows artifact, so a tolerated msedgedriver download failure inside a job
whose journey still passed would leave no trace in these logs. None of the other
22 job logs contains a driver, WebDriver or msedgedriver error.

The only pre-test startup failure found is job 115369401264. Its job log reports
`SevereServiceError: Failed to start tauri-driver ... failed to become ready within
10000ms`. The run's `desktop-e2e-windows-2025` artifact (11826972346) supplies the
missing antecedent: WebView2 153.0.4234.48 needed msedgedriver; the check began at
15:19:34.042Z and the PowerShell download failed at 15:20:53.211Z. The service logged “continuing anyway”, launched
tauri-driver at 15:20:53.369Z, and timed out at 15:21:03.494Z. Repeated
`hyper::Error(IncompleteMessage)` shows an intermediary listening without a
usable native status response. The logs do not reveal the downloader's underlying
network/PowerShell error or prove whether a stale native executable was found;
claiming either would exceed the evidence.

The cause sat in the repo's `tests/tauri-launcher-service.ts` re-export of
`@wdio/tauri-service` 1.2.0, selected by `wdio.conf.ts`:
upstream `ensureMsEdgeDriver` errors were tolerated when auto-download was enabled,
and its `DriverPool` delegated to `@wdio/native-core`'s hard-coded 10,000ms
`pollForReadiness`. The configurable startup timeout did not extend that poll.
The finished tree replaces that re-export with local launcher lifecycle code in
`packages/desktop-driver/src/tauri-launcher-service.ts`, native discovery and
validated subprocess output in `native-driver.ts`, and explicit Windows
preparation in `prepare-edge-driver.ps1`. No product/journey assertion changed. A local freshness gate reconciles both
PowerShell result key sets and its version-match pattern with the Zod consumer;
renaming the producer's `version` field to `driverVersion` made that gate fail,
and restoring the producer made it pass.

The Windows preparation selects a WebView2-major-matched PATH msedgedriver or
retries CDN download three times and verifies the executable's reported version.
Both existing and downloaded executables must have a valid Microsoft Corporation
Authenticode signature before their version command runs. Preparation fails and
names msedgedriver if it cannot supply a verified file;
it passes the selected absolute path to tauri-driver. Each CDN request is bounded
at 60 seconds, the version lookup at 15 seconds, and the whole preparation process
at 240 seconds. Startup then polls the intermediary's `/status` until the native
response has `value.ready: true`. The new startup limit is **120,000ms** to allow
runner contention and late native startup beyond the former ten-second limit,
while retaining a finite diagnostic failure. This is a failure bound, not a delay.
Requests are individually bounded at two seconds and never extend the remaining
startup deadline. Early process exits and failed spawns also fail with diagnostics.

Tauri's [2.0.6 entry point](https://github.com/tauri-apps/tauri/blob/tauri-driver-v2.0.6/crates/tauri-driver/src/main.rs)
spawns the native WebDriver before running its intermediary; its
[server](https://github.com/tauri-apps/tauri/blob/tauri-driver-v2.0.6/crates/tauri-driver/src/server.rs)
forwards `/status` to the native port. Checking that response establishes readiness
of both processes, whereas a listening intermediary alone does not.

Regression evidence: the test runs the actual launcher with a real subprocess
that announces listening while native readiness is held by a control HTTP request.
Releasing that held step allows setup to complete; withholding it produces a
bounded failure identifying both executables and `HTTP 200; ready was not true`.
With the launcher restored from dispatch base
`2eb9a508b13e2e699ede2fb0070140e2f931c45a`, the held-step test failed at
`expect(prepared).toBe(false)` with `Received: true`: the original launcher accepted
an HTTP status response with `ready:false` before native readiness. The finished launcher passes it. The failure test holds native readiness while the real startup deadline expires;
it uses a ten-second test bound and no timing sleep or injected clock. Additional tests cover executable and
configuration validation, a missing native executable and an early driver exit.
Native Windows execution and the Windows PowerShell preparation remain for the
merge path; this host is Linux.

The final read-only observation found Windows attempt 2 job **115406088574**
completed successfully; its log reports `native desktop journey: ok`. Ubuntu
attempt 2 job 115406091573 also passed. This retry used the unchanged PR head
and does not verify the dispatch's changed code.

Final local validation uses the repository's affected command surface:
`NX_BASE=2eb9a508b13e2e699ede2fb0070140e2f931c45a NX_HEAD=HEAD just check-affected`.
Driver readiness tests run in `desktop-driver:test`, an independent shared
project with no workspace dependencies or product build prerequisites. The
packaged journey imports its launcher through the existing service adapter and
depends on `desktop-driver` for affected selection; its inputs explicitly include
`packages/desktop-driver/src/**/*`, including the Windows preparation script.
The held-readiness success/failure tests and their ten-second real failure bound
are preserved: ten driver tests and 18 product-specific helper tests pass. Graph and real-selector tests verify that launcher changes select
both helper checks and the native journey, while product changes select the
journey without selecting the driver helper tier. Deliberately adding a product
dependency made the selector regression fail with `run=true` instead of
`run=false`; restoring the independent graph made it pass. The relocated held
readiness test was also observed failing against the dispatch-base launcher at
`expect(prepared).toBe(false)` with `Received: true`. Formatting, lint, typecheck
and tests run through the affected gate. Documentation version drift verification and its regression test pass.
PowerShell's `Parser.ParseFile` reports no syntax errors. These local checks do
not execute Windows registry, Authenticode or native-driver download operations.
The required semantic tier is
`just lint-llm-diff 2eb9a508b13e2e699ede2fb0070140e2f931c45a`.

The first publication of this launcher failed `install (ubuntu-22.04-arm)` job
115445244906 at session creation, after readiness passed: WebKitWebDriver
answered `Failed to match capabilities` because the replacement launcher, unlike
`@wdio/tauri-service`, forwarded `browserName: "tauri"`. The launcher now rejects
any browserName other than `tauri` or `wry` and removes it before the session,
as the upstream service does. The held-readiness test's driver rejects a session
request carrying browserName; against the published launcher that request got
HTTP 500 instead of 200, and it passes on the finished tree.

The second publication failed `desktop-e2e (windows-2025)` job 115461460672 (run
38445145650, head `d9716bf`) with the session error `No "browserName" defined in
capabilities nor hostname or port found!`. Its artifact's `wdio.log` holds the
real failure, 47.9 seconds into `onPrepare`: `prepare-edge-driver.ps1` threw
`msedgedriver has no configured download for Windows architecture` with an empty
architecture. The PATH msedgedriver did not match the WebView2 major, so the
script reached its download branch, which read `PROCESSOR_ARCHITECTURE`; the
journey runs under `deterministicDesktopEnvironment`'s allowlist in
`apps/desktop-shell/tests/fixture.ts`, which does not pass that variable on. WDIO
then logged the launcher's plain `Error` as `Continue...`, because
`@wdio/cli` stops a run only for an error named `SevereServiceError`, and started
a session from capabilities whose `browserName` the launcher had already removed.

The finished tree resolves the download architecture in
`packages/desktop-driver/src/edge-driver-architecture.ps1` from
`RuntimeInformation.OSArchitecture`, using the processor variables only when the
runtime cannot answer. The launcher reports every startup failure as
`SevereServiceError`, so WDIO stops with the driver's own message. It removes
`browserName` only together with setting the ready driver's host and port. A
test runs the architecture script under PowerShell with only `PATH` and
`SystemRoot`. It failed against the previous script, which threw with an empty
architecture, and passes now. The withheld-readiness and absent-executable tests
assert the `SevereServiceError` name and unchanged capabilities. A
`desktop-shell-e2e` test runs the installed `@wdio/cli` `Launcher` with the
journey's service adapter and an absent native driver. It requires the run to
stop with that driver error. Against the published launcher, the run resolved
after starting a worker. All three tests failed there and pass now. The accepted
`tauri`/`wry` browser names are reconciled with `@wdio/tauri-service`'s own
validation. The download itself and the
Windows PowerShell 5.1 runtime remain for the merge path.

The readiness regression seam replaces only the driver's readiness behavior;
it invokes the real local launcher and its process, HTTP, error and cleanup
boundaries. Its narrow `e2e_not_mocked` annotation documents this task's explicit
held-readiness requirement. It does not claim real Windows driver coverage.

The `expensive_tests_stay_behind_their_own_edge` suppression is removed. Driver
lifecycle implementation and regression tests now share the isolated
`packages/desktop-driver` project. Helper-project isolation is complete; the
non-blocking upstream defect report remains separate. No shared lint rules or
thresholds were weakened. Test ownership changed structurally: the existing
product-specific helper target remains in `desktop-shell-e2e`, while the bounded
startup regression runs only in `desktop-driver:test` when its own inputs change.
