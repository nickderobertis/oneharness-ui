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
      └─ fixed Tauri command (no webview shell permission)
          └─ oneharness-ui bridge (bundled Bun executable)
              └─ @oneharness/sdk (types + runtime contract validation)
                  └─ packaged oneharness CLI
                      └─ local config, history, and harness process
```

Rust exposes one fixed JSON transport command and grants the webview no shell
permission. It does not contain oneharness types or accept arbitrary commands.
The bridge is the only package that imports the SDK, and the browser receives a
smaller application view model validated on both sides of IPC. See
[the architecture decision](docs/architecture.md).

## Prerequisites

- Bun 1.3.14, Node 26.5.0, Rust 1.96.0, just 1.42.4, and uv 0.11.28
  (pinned in `.tool-versions` and `rust-toolchain.toml`)
- `curl` and the native [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- On Linux: WebKitGTK 4.1, GTK 3, appindicator, librsvg, `pkg-config`, and
  `patchelf`
- For native desktop E2E on Linux: `webkit2gtk-driver` and a display (or `xvfb`)

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

## Install

Install the latest release noninteractively with the public POSIX installer:

```sh
curl -fsSL https://raw.githubusercontent.com/nickderobertis/oneharness-ui/main/scripts/install.sh | sh
```

It detects Linux `x86_64`/`aarch64`, macOS Apple Silicon, or Windows `x86_64`
under a POSIX shell; downloads the matching GitHub release asset and companion
`.sha256`; and refuses to install unless SHA-256 verification succeeds. Linux
keeps the verified AppImage and one cached extraction under `~/.local/bin`, then
installs `~/.local/bin/oneharness-ui` as a launcher. The launcher uses the
AppImage on accessible-FUSE hosts and the cached `AppRun` when `/dev/fuse` is
unavailable or `APPIMAGE_EXTRACT_AND_RUN=1` is set. macOS installs to
`~/Applications`, and Windows runs the MSI quietly.

Pin a release or choose the Linux/macOS destination (flags override
`ONEHARNESS_UI_VERSION` and `ONEHARNESS_UI_INSTALL_DIR`):

```sh
curl -fsSL https://raw.githubusercontent.com/nickderobertis/oneharness-ui/main/scripts/install.sh \
  | sh -s -- --version v0.2.1 --to ~/.local/bin
```

Set `GITHUB_TOKEN` if unauthenticated API rate limiting prevents latest-release
resolution. Direct release downloads remain available as `.deb` and AppImage
artifacts for Ubuntu/Linux `x86_64` and `aarch64`, a DMG for macOS Apple Silicon,
and MSI/NSIS installers for Windows `x86_64`; every artifact has its own
mandatory `.sha256` asset.

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

Run the focused browser journey with `just test-e2e`. On Linux or Windows, run
the additional packaged Tauri journey with `just test-desktop-e2e`; it builds
the platform installer and drives that release application through
WebdriverIO and the pinned official `tauri-driver`. See
[native desktop E2E](docs/native-desktop-e2e.md) for platform prerequisites and
the precise macOS limitation.

The app discovers the same layered oneharness config and platform history
directory as the CLI. `ONEHARNESS_BIN` selects an explicit executable and
`ONEHARNESS_UI_HISTORY_DIR` selects an explicit history directory. Errors name
the failing path and suggest the relevant setting.

Linux `aarch64` Tauri and AppImage artifacts are built natively on Ubuntu 22.04
so the desktop startup ABI remains compatible with glibc 2.35. Linux `x86_64`
artifacts continue to build on Ubuntu 24.04.

Selection is durable in `?session=<id>`. A conversation is continuable only
when its latest SDK-validated record holds an eligible native `session_id`.
Submitting a reply calls SDK `run({ resume, prompt })`, records a new history
session, refreshes the list, and selects that result.

## SDK package pin

The bridge reproducibly pins the public `@oneharness/sdk` package to `0.3.23`.
That package owns the generated TypeScript contracts and Zod schemas and brings
the matching packaged `oneharness-cli` binary for each supported platform. The
repository keeps only its UI-specific IPC/view-model schemas. Tests compile a
credential-free deterministic provider fixture and pass it through the real
SDK → packaged CLI → provider process seam.

## Quality and release

`just check` runs format, Biome/accessibility/import-boundary lint, TypeScript,
Clippy, unit/integration coverage (minimum 95%), real Playwright journeys,
static export, Rust checks, dependency policy, and audits. Tests replace only
paid model execution with oneharness's own deterministic provider fixture; the
SDK, CLI, filesystem history, subprocess, bridge, HTTP/Tauri transport, and UI
remain real.

The separately required native desktop CI gate runs the packaged WebDriverIO
journey on Linux and Windows. macOS keeps a native DMG build/install smoke
because upstream official `tauri-driver` has no WKWebView driver.

Rust coverage excludes only `src/main.rs`, the two-line native GUI event-loop
entrypoint that cannot return under a headless coverage runner; its runtime
builder and every other authored Rust line remain measured.

On Windows, the gate compiles every Rust test target with `cargo test --no-run`:
the hosted runner's Tauri/WebView2 test binary fails in the Windows loader
before the test harness starts (`STATUS_ENTRYPOINT_NOT_FOUND`), even without
coverage instrumentation. Linux and macOS execute the same tests with the 95%
Rust coverage threshold; Windows still runs Clippy over all targets and builds
the production installer, so only test-binary execution is excluded there.

Conventional commits drive semantic-release on `main`. It creates `vX.Y.Z`, and
the version job reconciles a separate release workflow with the repository's
built-in token. That workflow accepts only a published semver release whose tag
is reachable from `main`, materializes the version in its build checkout, and
builds native Tauri installers and companion checksums on Linux `x86_64` and
`aarch64`, macOS Apple Silicon, and Windows `x86_64`. The release-like ARM64 CI
journey runs natively on Ubuntu 22.04, checksum-verifies and installs the
AppImage, forces the FUSE-free cached extraction path, and drives the rendered
application through official `tauri-driver`. The packaged Tauri E2E remains a
separate required gate. There is no manual dispatch or hand-edited version.

MIT licensed. Security reports follow [SECURITY.md](SECURITY.md).
