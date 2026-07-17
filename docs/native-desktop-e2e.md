# Native desktop E2E

Run `just test-desktop-e2e` on Linux or Windows. The command builds the release
application and its platform installer, creates isolated history through the
SDK-packaged oneharness CLI, launches the real Tauri binary, and drives its WebView
with WebdriverIO through official `tauri-driver` 2.0.6. Bootstrap installs that
exact driver version.

Linux also needs `webkit2gtk-driver` and a display. For a headless host:

```console
sudo apt-get install webkit2gtk-driver xvfb
xvfb-run -a just test-desktop-e2e
```

Windows uses WebView2; the pinned WebdriverIO Tauri service downloads the Edge
driver matching the installed runtime. The session gives EdgeDriver and Tauri
the same isolated, writable WebView2 user-data folder through the driver
capability and EdgeDriver's documented host-application argument channel. An
automation-only Tauri window configuration validates that argument before use,
so the driver can discover the application's DevTools endpoint without touching
the user's normal application profile. Only the service's launcher runs:
its worker APIs require the test-only Tauri WDIO plugin, while this journey uses
standard WebDriver operations and keeps the release application uninstrumented.
Failure screenshots, driver logs, and an ordered `stages.log` stay under
`test-results/desktop-e2e`; pre-session failures also record whether Tauri
accepted the profile and whether WebView2 created `DevToolsActivePort`.
Successful runs remove the diagnostics.

The ARM64 release-like lane uses the same driver against the public-installer
layout on a native Ubuntu 22.04 ARM runner. It sets
`APPIMAGE_EXTRACT_AND_RUN=1`, launches the installer's cached `AppRun` without
FUSE, and asserts that the real window, local sidecar, empty SDK history, and
refreshable conversation UI reach the native startup boundary. Release builds
repeat that journey before uploading the ARM64 assets. The ARM bundle compiles
the SDK-matched oneharness 0.3.23 CLI from its pinned upstream commit on the
same Ubuntu 22.04 runner, so initial history discovery crosses the compatible
CLI boundary too.

The fixture replaces only paid model execution with oneharness's own
deterministic provider binary. History creation, the packaged UI, Tauri command,
bundled sidecar, pinned SDK, bundled CLI, filesystem, and refresh remain real.
Provider argv is asserted so the journey proves the exact native session is
resumed. `ONEHARNESS_NO_CONFIG=1` and the explicit fixture binary prevent a
developer or CI config from selecting a paid provider.

Official `tauri-driver` supports Windows and Linux, but macOS exposes no
WKWebView WebDriver. Tauri documents this exact limitation in its
[manual setup guide](https://v2.tauri.app/develop/tests/webdriver/manual-setup/),
and WebdriverIO lists the external provider as Windows/Linux-only in its
[platform guide](https://webdriver.io/docs/desktop-testing/tauri/platform-support/).
The macOS CI lane therefore builds, mounts, installs, and verifies the native
DMG; it does not claim WebDriver coverage. Embedded and paid CrabNebula drivers
are different providers and are outside this official-`tauri-driver` journey.
