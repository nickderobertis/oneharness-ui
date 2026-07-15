/// Build the least-privilege desktop runtime. The capability manifest limits
/// the shell plugin to the bundled bridge sidecar.
pub fn builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default().plugin(tauri_plugin_shell::init())
}

#[cfg(test)]
mod tests {
    #[test]
    fn constructs_the_scoped_runtime() {
        let _builder = super::builder();
    }
}
