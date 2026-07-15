#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> Result<(), Box<dyn std::error::Error>> {
    oneharness_ui::runtime::builder().run(tauri::generate_context!())?;
    Ok(())
}
