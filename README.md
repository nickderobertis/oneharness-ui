# oneharness UI

A restrained local desktop reader for real [oneharness](https://github.com/nickderobertis/oneharness)
history. Browse recorded sessions, inspect normalized tool activity and optional
reasoning, distinguish run outcomes and unreported usage, and continue an
eligible conversation through its exact native harness session.

The app never sends history to a service and never renders session content as
HTML. The Next.js interface is statically exported into a Tauri v2 webview.

## Architecture

```text
Next.js webview
  └─ validated app IPC request
      └─ Tauri scoped sidecar permission
          └─ oneharness-ui bridge (Bun executable)
              └─ @oneharness/sdk (types + runtime contract validation)
                  └─ pinned oneharness CLI
                      └─ local config, history, and harness process
```

Rust grants the webview only permission to spawn the bundled bridge. It does
not contain oneharness types or accept arbitrary shell commands. The bridge is
the only package that imports the SDK, and the browser receives a smaller
application view model validated on both sides of IPC. See
[the architecture decision](docs/architecture.md).

## Prerequisites

- Bun 1.3.14, Rust 1.96.0, just 1.42.4, and uv 0.11.28 (pinned in `.tool-versions` and
  `rust-toolchain.toml`)
- `curl` and the native [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- On Linux: WebKitGTK 4.1, GTK 3, appindicator, librsvg, `pkg-config`, and
  `patchelf`

From a clean clone:

```console
just bootstrap
just check
```

`bootstrap` downloads the immutable upstream oneharness source archive,
verifies its SHA-256, builds its SDK package and compatible CLI, installs the
workspace, and provisions the pinned Rust gate tools. `just --list` shows the
complete command surface. Recipes with release inputs accept validated
environment values (for example, `BUNDLE_FORMATS=deb just bundle`) so values
are never interpolated into shell source.

For an end-user install, download the native artifact for your platform from
the repository's GitHub release and use the platform installer:

```console
# Debian/Ubuntu
sudo dpkg -i oneharness_*.deb

# macOS (then drag oneharness.app to Applications)
hdiutil attach oneharness_*.dmg

# Windows PowerShell
msiexec.exe /i oneharness_*.msi
```

## Use

oneharness history must be enabled before sessions can appear. Set this in an
applicable `oneharness.toml` or pass `--history` to a run:

```toml
history = true
```

Start the desktop app during development:

```console
just dev
```

The app discovers the same layered oneharness config and platform history
directory as the CLI. `ONEHARNESS_BIN` selects an explicit executable and
`ONEHARNESS_UI_HISTORY_DIR` selects an explicit history directory. Errors name
the failing path and suggest the relevant setting.

Selection is durable in `?session=<id>`. A conversation is continuable only
when its latest SDK-validated record holds an eligible native `session_id`.
Submitting a reply calls SDK `run({ resume, prompt })`, records a new history
session, refreshes the list, and selects that result.

## SDK source pin

`@oneharness/sdk` is not yet published to npm. `scripts/fetch-sdk.sh` consumes
oneharness commit `964a5e030b2e0caa4cd0827ac871a0f94ca1d8a5`, verifies source archive
SHA-256 `beb8b4fe66d56dc212ab1105efa15c8d2e0479b070b3e470d1f68a6fe5138224`,
and builds the upstream package in that immutable source tree without copying
its contracts here. The workspace uses the assembled package directory rather
than a repacked tarball, avoiding platform-dependent archive metadata. The same
commit supplies the compatible CLI and deterministic provider fixture used by
boundary/e2e tests.

When a registry release is available, replace the bridge dependency with the
exact compatible `@oneharness/sdk` version, delete the SDK pack step, refresh
`bun.lock`, and keep all imports unchanged. The SDK remains the contract owner
in both layouts.

## Quality and release

`just check` runs format, Biome/accessibility/import-boundary lint, TypeScript,
Clippy, unit/integration coverage (minimum 95%), real Playwright journeys,
static export, Rust checks, dependency policy, and audits. Tests replace only
paid model execution with oneharness's own deterministic provider fixture; the
SDK, CLI, filesystem history, subprocess, bridge, HTTP/Tauri transport, and UI
remain real.

Rust coverage excludes only `src/main.rs`, the two-line native GUI event-loop
entrypoint that cannot return under a headless coverage runner; its runtime
builder and every other authored Rust line remain measured.

On Windows, Rust tests run normally but without `cargo llvm-cov`
instrumentation: the hosted runner's instrumented Tauri/WebView2 test binary
fails in the Windows loader before the test harness starts
(`STATUS_ENTRYPOINT_NOT_FOUND`). Linux and macOS execute the same tests with
the 95% Rust coverage threshold, while Windows still compiles and executes the
unmodified test binary.

Conventional commits drive semantic-release on `main`. It updates every
manifest and changelog and creates `vX.Y.Z`; the tag builds native Tauri
installers and checksums on Linux, macOS, and Windows. There is no manual
dispatch or hand-edited version.

MIT licensed. Security reports follow [SECURITY.md](SECURITY.md).
