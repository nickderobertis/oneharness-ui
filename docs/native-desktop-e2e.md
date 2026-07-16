# Native desktop E2E

Run `just test-desktop-e2e` on Linux or Windows. The command builds the release
application and its platform installer, creates isolated history through the
pinned oneharness CLI, launches the real Tauri binary, and drives its WebView
with WebdriverIO through official `tauri-driver` 2.0.6. Bootstrap installs that
exact driver version.

Linux also needs `webkit2gtk-driver` and a display. For a headless host:

```console
sudo apt-get install webkit2gtk-driver xvfb
xvfb-run -a just test-desktop-e2e
```

Windows uses WebView2; the pinned WebdriverIO Tauri service downloads the Edge
driver matching the installed runtime. Failure screenshots and driver logs stay
under `test-results/desktop-e2e`; successful runs remove them.

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
