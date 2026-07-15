#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    oneharness_ui::runtime::builder()
        .run(tauri::generate_context!())
        .expect("oneharness-ui failed to start");
}
