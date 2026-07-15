use serde_json::Value;
use tauri::{AppHandle, Runtime};
use tauri_plugin_shell::{
    ShellExt,
    process::{Command, CommandEvent},
};

const MAX_REQUEST_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

fn append_bounded(target: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if target.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
        return Err("Local bridge response exceeded 4 MiB".to_string());
    }
    target.extend_from_slice(chunk);
    Ok(())
}

async fn run_bridge_command(
    command: Command,
    input: &[u8],
) -> Result<(Option<i32>, Vec<u8>, Vec<u8>), String> {
    let (mut events, mut child) = command
        .set_raw_out(true)
        .spawn()
        .map_err(|error| format!("Could not start the bundled local bridge: {error}"))?;
    if let Err(error) = child.write(input) {
        let _ = child.kill();
        return Err(format!(
            "Could not send the request to the local bridge: {error}"
        ));
    }

    let mut child = Some(child);
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code = None;
    while let Some(event) = events.recv().await {
        let result = match event {
            CommandEvent::Stdout(chunk) => append_bounded(&mut stdout, &chunk),
            CommandEvent::Stderr(chunk) => append_bounded(&mut stderr, &chunk),
            CommandEvent::Error(error) => Err(format!("Local bridge process error: {error}")),
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
                Ok(())
            }
            _ => Ok(()),
        };
        if let Err(error) = result {
            if let Some(running) = child.take() {
                let _ = running.kill();
            }
            return Err(error);
        }
    }
    Ok((exit_code, stdout, stderr))
}

fn decode_bridge_response(
    exit_code: Option<i32>,
    stdout: &[u8],
    stderr: &[u8],
) -> Result<Value, String> {
    if exit_code != Some(0) {
        let detail = String::from_utf8_lossy(stderr);
        let message = detail.trim();
        return Err(if message.is_empty() {
            format!("Local bridge exited with status {exit_code:?}")
        } else {
            message.to_string()
        });
    }
    serde_json::from_slice(stdout)
        .map_err(|error| format!("Local bridge returned malformed JSON: {error}"))
}

async fn invoke_bridge_for<R: Runtime>(app: AppHandle<R>, request: Value) -> Result<Value, String> {
    let mut input = serde_json::to_vec(&request)
        .map_err(|error| format!("Could not encode the validated bridge request: {error}"))?;
    if input.len() > MAX_REQUEST_BYTES {
        return Err("Local bridge request exceeded 64 KiB".to_string());
    }
    input.push(b'\n');

    let command = app
        .shell()
        .sidecar("binaries/oneharness-ui-bridge")
        .map_err(|error| format!("Could not resolve the bundled local bridge: {error}"))?;
    let (exit_code, stdout, stderr) = run_bridge_command(command, &input).await?;
    decode_bridge_response(exit_code, &stdout, &stderr)
}

#[tauri::command]
async fn invoke_bridge(app: AppHandle, request: Value) -> Result<Value, String> {
    invoke_bridge_for(app, request).await
}

/// Build the least-privilege desktop runtime. The webview can invoke one fixed
/// Rust command and has no shell permission.
pub fn builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![invoke_bridge])
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use serde_json::json;
    use tauri::{test::mock_context, test::noop_assets};
    use tauri_plugin_shell::ShellExt;

    fn install_bridge_fixture() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let source_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let source = fs::read_dir(source_directory)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with("oneharness-ui-bridge-")
                            && (cfg!(windows) == name.ends_with(".exe"))
                    })
            })
            .ok_or_else(|| std::io::Error::other("bootstrap did not build the bridge fixture"))?;
        let executable = std::env::current_exe()?;
        let target_directory = executable
            .parent()
            .and_then(|directory| {
                if directory.ends_with("deps") {
                    directory.parent()
                } else {
                    Some(directory)
                }
            })
            .ok_or_else(|| std::io::Error::other("test executable has no target directory"))?
            .join("binaries");
        fs::create_dir_all(&target_directory)?;
        let destination = target_directory.join(if cfg!(windows) {
            "oneharness-ui-bridge.exe"
        } else {
            "oneharness-ui-bridge"
        });
        fs::copy(source, &destination)?;
        Ok(destination)
    }

    #[test]
    fn constructs_the_scoped_runtime() {
        let _builder = super::builder();
    }

    #[test]
    fn transports_validated_json_through_the_real_bridge() -> Result<(), Box<dyn std::error::Error>>
    {
        let fixture = install_bridge_fixture()?;
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .build(mock_context(noop_assets()))?;
        let response = tauri::async_runtime::block_on(super::invoke_bridge_for(
            app.handle().clone(),
            json!({ "kind": "unknown" }),
        ))
        .map_err(std::io::Error::other)?;
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "INVALID_REQUEST");
        fs::remove_file(fixture)?;
        Ok(())
    }

    #[test]
    fn rejects_oversized_requests_before_process_launch() -> Result<(), Box<dyn std::error::Error>>
    {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .build(mock_context(noop_assets()))?;
        let result = tauri::async_runtime::block_on(super::invoke_bridge_for(
            app.handle().clone(),
            json!({ "message": "x".repeat(super::MAX_REQUEST_BYTES) }),
        ));
        let error = match result {
            Ok(_) => return Err(std::io::Error::other("oversized input was accepted").into()),
            Err(error) => error,
        };
        assert!(error.contains("64 KiB"));
        Ok(())
    }

    #[test]
    fn reports_process_and_response_failures() -> Result<(), Box<dyn std::error::Error>> {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .build(mock_context(noop_assets()))?;
        let spawn_error = tauri::async_runtime::block_on(super::run_bridge_command(
            app.shell()
                .command("oneharness-ui-command-that-does-not-exist"),
            b"{}\n",
        ));
        assert!(matches!(spawn_error, Err(message) if message.contains("Could not start")));

        let command = app.shell().command("bun").args([
            "-e",
            "process.stdin.once('data',()=>{process.stderr.write('provider unavailable');process.exit(7)});process.stdin.resume()",
        ]);
        let (code, stdout, stderr) =
            tauri::async_runtime::block_on(super::run_bridge_command(command, b"{}\n"))
                .map_err(std::io::Error::other)?;
        let failure = super::decode_bridge_response(code, &stdout, &stderr);
        assert!(matches!(failure, Err(message) if message == "provider unavailable"));

        let empty_failure = super::decode_bridge_response(Some(9), b"", b"");
        assert!(matches!(empty_failure, Err(message) if message.contains("Some(9)")));
        let malformed = super::decode_bridge_response(Some(0), b"not-json", b"");
        assert!(matches!(malformed, Err(message) if message.contains("malformed JSON")));
        Ok(())
    }

    #[test]
    fn terminates_a_bridge_that_exceeds_the_response_limit()
    -> Result<(), Box<dyn std::error::Error>> {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .build(mock_context(noop_assets()))?;
        let command = app.shell().command("bun").args([
            "-e",
            "process.stdin.once('data',()=>process.stdout.write('x'.repeat(5*1024*1024)));process.stdin.resume()",
        ]);
        let result = tauri::async_runtime::block_on(super::run_bridge_command(command, b"{}\n"));
        assert!(matches!(result, Err(message) if message.contains("exceeded 4 MiB")));
        Ok(())
    }
}
