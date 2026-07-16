#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut context = tauri::generate_context!();
    oneharness_ui::runtime::configure_context(&mut context)?;
    oneharness_ui::runtime::builder().run(context)?;
    Ok(())
}
