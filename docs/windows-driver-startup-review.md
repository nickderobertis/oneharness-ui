# Windows desktop WebDriver startup review

Reviewed read-only: every completed `desktop-e2e` workflow run created from
2026-10-06T00:00:00Z through 2026-10-13T16:00:00Z, plus the explicitly required
failed attempt 1 of run 38418554958. Its workflow was still running because of a
manager-initiated retry; this dispatch did not re-run, cancel or modify CI.
The inventory includes Windows jobs only. Successful native-journey commands
prove the tests ran; selection-only successes do not. The original 11-of-13
workflow-success figure counted selection skips, so it was not a journey pass rate.

| Run created (UTC) | Run | Windows job | Pre-test outcome |
| --- | --- | --- | --- |
| 2026-10-07T12:38:05Z | [37622408684](https://github.com/nickderobertis/oneharness-ui/actions/runs/37622408684) | 112795677648 | Cancelled before native journey |
| 2026-10-07T12:57:49Z | [37624826420](https://github.com/nickderobertis/oneharness-ui/actions/runs/37624826420) | 112804306181 | Cancelled before native journey |
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

The only pre-test startup failure found is job 115369401264. Its job log reports
`SevereServiceError: Failed to start tauri-driver ... failed to become ready within
10000ms`. The run's `desktop-e2e-windows-2025` artifact (11826972346) supplies the
missing antecedent: WebView2 153.0.4234.48 needed msedgedriver; the PowerShell
download failed at 15:20:53.211Z. The service logged “continuing anyway”, launched
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
`apps/desktop-shell-e2e/tests/tauri-launcher-service.ts`, native discovery and
validated subprocess output in `native-driver.ts`, and explicit Windows
preparation in `prepare-edge-driver.ps1`. No product/journey assertion changed.

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
an HTTP status response with `ready:false` before native readiness. The finished launcher passes it. The failure test advances an injected monotonic
clock past its bound only after the child has served a held `ready:false` status,
so the regression needs no timing sleep. Additional tests cover executable and
configuration validation, a missing native executable and an early driver exit.
Native Windows execution and the Windows PowerShell preparation remain for the
merge path; this host is Linux.

At the final read-only observation, Windows attempt 2 job **115406088574** was
still running; Ubuntu attempt 2 job 115406091573 had passed. This retry does not
verify the dispatch's changed code.

Final local validation uses the repository's affected command surface:
`NX_BASE=2eb9a508b13e2e699ede2fb0070140e2f931c45a NX_HEAD=HEAD just check-affected`.
The e2e helper suite has 25 passing tests; its formatting, lint and typecheck
also pass. Documentation version drift verification and its regression test pass.
PowerShell's `Parser.ParseFile` reports no syntax errors. These local checks do
not execute Windows registry, Authenticode or native-driver download operations.
The required semantic tier is
`just lint-llm-diff 2eb9a508b13e2e699ede2fb0070140e2f931c45a`.

The readiness regression seam replaces only the driver's readiness behavior;
it invokes the real local launcher and its process, HTTP, error and cleanup
boundaries. Its narrow `e2e_not_mocked` annotation documents this task's explicit
held-readiness requirement. It does not claim real Windows driver coverage.
