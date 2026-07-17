// The packaged journey needs the external driver's lifecycle, but it does not
// use the plugin-backed Tauri execute, mock, log, or multi-window APIs.
export { launcher } from "@wdio/tauri-service";
