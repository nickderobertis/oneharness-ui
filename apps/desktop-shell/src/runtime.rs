use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Runtime};
use tauri_plugin_shell::{
    ShellExt,
    process::{Command, CommandChild, CommandEvent},
};

const MAX_REQUEST_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const BRIDGE_SIDECAR: &str = "oneharness-ui-bridge";
#[cfg(any(windows, test))]
const FIXTURE_ROOT_PREFIX: &str = "oneharness-ui-desktop-e2e-";
#[cfg(any(windows, test))]
const AUTOMATION_PROFILE_ARGUMENT: &str = "--oneharness-webdriver-profile=";
#[cfg(any(windows, test))]
const AUTOMATION_PROFILE_READY_MARKER: &str = "tauri-profile-ready";

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WebViewAutomation {
    Disabled,
    Enabled,
}

#[cfg(any(windows, test))]
impl WebViewAutomation {
    fn parse(value: Option<&std::ffi::OsStr>) -> std::io::Result<Self> {
        match value {
            None => Ok(Self::Disabled),
            Some(value) if value == "true" => Ok(Self::Enabled),
            Some(_) => Err(std::io::Error::other(
                "TAURI_WEBVIEW_AUTOMATION must be absent or true",
            )),
        }
    }
}

#[cfg(any(windows, test))]
#[derive(Debug, Eq, PartialEq)]
struct ValidatedAutomationDataDirectory {
    absolute: std::path::PathBuf,
    relative: std::path::PathBuf,
}

#[cfg(any(windows, test))]
impl ValidatedAutomationDataDirectory {
    fn parse<I>(
        automation: WebViewAutomation,
        arguments: I,
        local_app_data: Option<&std::ffi::OsStr>,
    ) -> std::io::Result<Option<Self>>
    where
        I: IntoIterator<Item = std::ffi::OsString>,
    {
        use std::path::{Component, Path, PathBuf};

        if automation == WebViewAutomation::Disabled {
            return Ok(None);
        }
        let mut user_data_directory = None;
        for argument in arguments {
            let Some(value) = argument
                .to_str()
                .and_then(|argument| argument.strip_prefix(AUTOMATION_PROFILE_ARGUMENT))
            else {
                continue;
            };
            if value.is_empty() || user_data_directory.replace(PathBuf::from(value)).is_some() {
                return Err(std::io::Error::other(
                    "Windows WebView2 automation profile argument was invalid",
                ));
            }
        }
        let user_data_directory = user_data_directory.ok_or_else(|| {
            std::io::Error::other("Windows WebView2 automation profile was not configured")
        })?;
        let local_app_data = local_app_data.ok_or_else(|| {
            std::io::Error::other("Windows WebView2 automation profile root was not configured")
        })?;
        let local_app_data = std::fs::canonicalize(Path::new(local_app_data))?;
        let user_data_directory = std::fs::canonicalize(user_data_directory)?;
        if !user_data_directory.is_dir() {
            return Err(std::io::Error::other(
                "Windows WebView2 automation profile is not a directory",
            ));
        }
        let relative = user_data_directory
            .strip_prefix(&local_app_data)
            .map_err(|_| {
                std::io::Error::other("Windows WebView2 automation profile escaped its root")
            })?;
        let mut components = relative.components();
        let valid_label =
            matches!(components.next(), Some(Component::Normal(label)) if label == "main");
        let fixture_name = match components.next() {
            Some(Component::Normal(name))
                if name.to_str().is_some_and(|name| {
                    name.starts_with(FIXTURE_ROOT_PREFIX) && name.len() > FIXTURE_ROOT_PREFIX.len()
                }) =>
            {
                name
            }
            _ => {
                return Err(std::io::Error::other(
                    "Windows WebView2 automation profile did not belong to the desktop fixture",
                ));
            }
        };
        let valid_directory = matches!(
            components.next(),
            Some(Component::Normal(name)) if name == "webview2-user-data"
        );
        if !valid_label || !valid_directory || components.next().is_some() {
            return Err(std::io::Error::other(
                "Windows WebView2 automation profile did not match Tauri's window directory",
            ));
        }
        Ok(Some(Self {
            absolute: user_data_directory,
            relative: PathBuf::from(fixture_name).join("webview2-user-data"),
        }))
    }

    fn record_ready(&self) -> std::io::Result<()> {
        let fixture_root = self.absolute.parent().ok_or_else(|| {
            std::io::Error::other("Windows WebView2 automation profile had no fixture root")
        })?;
        std::fs::write(
            fixture_root.join(AUTOMATION_PROFILE_READY_MARKER),
            b"ready\n",
        )
    }
}

#[cfg(any(windows, test))]
fn apply_automation_data_directory<R: Runtime>(
    context: &mut tauri::Context<R>,
    directory: Option<ValidatedAutomationDataDirectory>,
) -> std::io::Result<()> {
    let Some(directory) = directory else {
        return Ok(());
    };
    let window = context
        .config_mut()
        .app
        .windows
        .iter_mut()
        .find(|window| window.label == "main")
        .ok_or_else(|| {
            std::io::Error::other("Tauri's main automation window was not configured")
        })?;
    window.data_directory = Some(directory.relative);
    Ok(())
}

/// Give Tauri and EdgeDriver the same isolated WebView2 profile during the
/// explicitly enabled Windows WebDriver journey. Normal application launches
/// retain Tauri's identifier-based profile.
pub fn configure_context<R: Runtime>(context: &mut tauri::Context<R>) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        let automation =
            WebViewAutomation::parse(std::env::var_os("TAURI_WEBVIEW_AUTOMATION").as_deref())?;
        let directory = ValidatedAutomationDataDirectory::parse(
            automation,
            std::env::args_os(),
            std::env::var_os("LOCALAPPDATA").as_deref(),
        )?;
        if let Some(directory) = &directory {
            directory.record_ready()?;
        }
        apply_automation_data_directory(context, directory)
    }
    #[cfg(not(windows))]
    {
        let _ = context;
        Ok(())
    }
}

/// Opaque transport envelope. The sidecar's SDK-owned schema validates its
/// contents; Rust owns only the privilege boundary and cannot construct SDK
/// contract values.
#[derive(Debug, Deserialize)]
#[serde(transparent)]
struct BridgeRequest(Value);

/// Opaque transport envelope returned after the SDK boundary has validated it.
#[derive(Debug, Serialize)]
#[serde(transparent)]
struct BridgeResponse(Value);

fn append_bounded(target: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if target.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
        return Err("Local bridge response exceeded 4 MiB".to_string());
    }
    target.extend_from_slice(chunk);
    Ok(())
}

fn sanitized_cleanup_result<E>(primary: String, cleanup: Result<(), E>) -> String {
    match cleanup {
        Ok(()) => primary,
        Err(_) => format!("{primary}; the local bridge process could not be stopped"),
    }
}

fn stop_after_error(child: CommandChild, primary: String) -> String {
    sanitized_cleanup_result(primary, child.kill())
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
        let primary = format!("Could not send the request to the local bridge: {error}");
        return Err(stop_after_error(child, primary));
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
                return Err(stop_after_error(running, error));
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
) -> Result<BridgeResponse, String> {
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
        .map(BridgeResponse)
        .map_err(|error| format!("Local bridge returned malformed JSON: {error}"))
}

#[tauri::command]
async fn invoke_bridge<R: Runtime>(
    app: AppHandle<R>,
    request: BridgeRequest,
) -> Result<BridgeResponse, String> {
    let mut input = serde_json::to_vec(&request.0)
        .map_err(|error| format!("Could not encode the validated bridge request: {error}"))?;
    if input.len() > MAX_REQUEST_BYTES {
        return Err("Local bridge request exceeded 64 KiB".to_string());
    }
    input.push(b'\n');

    let command = app
        .shell()
        .sidecar(BRIDGE_SIDECAR)
        .map_err(|error| format!("Could not resolve the bundled local bridge: {error}"))?;
    let (exit_code, stdout, stderr) = run_bridge_command(command, &input).await?;
    decode_bridge_response(exit_code, &stdout, &stderr)
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
    use std::path::{Path, PathBuf};

    use serde_json::json;
    use tauri::{
        WebviewWindowBuilder,
        ipc::{CallbackFn, InvokeBody},
        test::{INVOKE_KEY, get_ipc_response, mock_context, noop_assets},
        webview::InvokeRequest,
    };
    use tauri_plugin_shell::ShellExt;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn create(name: &str) -> Result<Self, std::io::Error> {
            let path =
                std::env::temp_dir().join(format!("oneharness-ui-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path)?;
            Ok(Self(path))
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn automation_profile_arguments(path: Option<&Path>) -> Vec<std::ffi::OsString> {
        let mut arguments = vec![std::ffi::OsString::from("oneharness-ui")];
        if let Some(path) = path {
            let mut argument = std::ffi::OsString::from(super::AUTOMATION_PROFILE_ARGUMENT);
            argument.push(path);
            arguments.push(argument);
        }
        arguments
    }

    fn packaged_bridge_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let executable = std::env::current_exe()?;
        let sidecar = executable
            .parent()
            .and_then(|directory| directory.parent())
            .ok_or_else(|| std::io::Error::other("test executable has no target directory"))?
            .join(super::BRIDGE_SIDECAR);
        #[cfg(windows)]
        let sidecar = sidecar.with_extension("exe");
        Ok(sidecar)
    }

    fn require_packaged_bridge(sidecar: &Path) -> Result<(), Box<dyn std::error::Error>> {
        if sidecar.is_file() {
            return Ok(());
        }
        Err(std::io::Error::other(format!(
            "tauri-build did not stage the bridge beside the application at {}",
            sidecar.display()
        ))
        .into())
    }

    #[test]
    fn constructs_the_scoped_runtime() {
        let _builder = super::builder();
    }

    #[test]
    fn isolates_the_windows_automation_profile_for_tauri_and_edgedriver()
    -> Result<(), Box<dyn std::error::Error>> {
        let local_app_data = TestDirectory::create("webview2-profile")?;
        let fixture_name = "oneharness-ui-desktop-e2e-profile";
        let user_data_directory = local_app_data
            .path()
            .join("main")
            .join(fixture_name)
            .join("webview2-user-data");
        std::fs::create_dir_all(&user_data_directory)?;

        let directory = super::ValidatedAutomationDataDirectory::parse(
            super::WebViewAutomation::Enabled,
            automation_profile_arguments(Some(&user_data_directory)),
            Some(local_app_data.path().as_os_str()),
        )?
        .expect("valid automation profile was ignored");
        assert_eq!(directory.absolute, user_data_directory);
        assert_eq!(
            directory.relative,
            PathBuf::from(fixture_name).join("webview2-user-data"),
        );
        directory.record_ready()?;
        assert!(
            local_app_data
                .path()
                .join("main")
                .join(fixture_name)
                .join(super::AUTOMATION_PROFILE_READY_MARKER)
                .is_file()
        );
        assert_eq!(
            super::ValidatedAutomationDataDirectory::parse(
                super::WebViewAutomation::Disabled,
                [std::ffi::OsString::from("untrusted")],
                None,
            )?,
            None,
        );
        assert_eq!(
            super::WebViewAutomation::parse(None)?,
            super::WebViewAutomation::Disabled,
        );
        assert_eq!(
            super::WebViewAutomation::parse(Some(std::ffi::OsStr::new("true")))?,
            super::WebViewAutomation::Enabled,
        );
        assert!(super::WebViewAutomation::parse(Some(std::ffi::OsStr::new("false"))).is_err());
        let empty_profile = std::ffi::OsString::from(super::AUTOMATION_PROFILE_ARGUMENT);
        assert!(
            super::ValidatedAutomationDataDirectory::parse(
                super::WebViewAutomation::Enabled,
                [empty_profile],
                Some(local_app_data.path().as_os_str()),
            )
            .is_err()
        );
        let mut duplicate_profiles = automation_profile_arguments(Some(&user_data_directory));
        let duplicate_profile = duplicate_profiles
            .last()
            .expect("automation profile argument is missing")
            .clone();
        duplicate_profiles.push(duplicate_profile);
        assert!(
            super::ValidatedAutomationDataDirectory::parse(
                super::WebViewAutomation::Enabled,
                duplicate_profiles,
                Some(local_app_data.path().as_os_str()),
            )
            .is_err()
        );
        let expected = PathBuf::from(fixture_name).join("webview2-user-data");
        let mut context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        super::apply_automation_data_directory(&mut context, Some(directory))?;
        assert_eq!(
            context
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .and_then(|window| window.data_directory.as_ref()),
            Some(&expected),
        );
        assert!(
            super::ValidatedAutomationDataDirectory::parse(
                super::WebViewAutomation::Enabled,
                automation_profile_arguments(Some(local_app_data.path())),
                Some(local_app_data.path().as_os_str()),
            )
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn rejects_unscoped_windows_automation_profiles() -> Result<(), Box<dyn std::error::Error>> {
        let local_app_data = TestDirectory::create("webview2-profile-boundary")?;
        let outside = TestDirectory::create("webview2-profile-outside")?;
        let file = local_app_data.path().join("profile-file");
        std::fs::write(&file, b"")?;

        for (input, root, expected) in [
            (None, Some(local_app_data.path()), "was not configured"),
            (
                Some(local_app_data.path()),
                None,
                "profile root was not configured",
            ),
            (
                Some(file.as_path()),
                Some(local_app_data.path()),
                "is not a directory",
            ),
            (
                Some(outside.path()),
                Some(local_app_data.path()),
                "escaped its root",
            ),
        ] {
            let error = super::ValidatedAutomationDataDirectory::parse(
                super::WebViewAutomation::Enabled,
                automation_profile_arguments(input),
                root.map(Path::as_os_str),
            )
            .expect_err("unscoped automation profile was accepted");
            assert!(error.to_string().contains(expected));
        }

        let invalid_fixture = local_app_data
            .path()
            .join("main")
            .join("untrusted")
            .join("webview2-user-data");
        let invalid_label = local_app_data
            .path()
            .join("other")
            .join("oneharness-ui-desktop-e2e-profile")
            .join("webview2-user-data");
        std::fs::create_dir_all(&invalid_fixture)?;
        std::fs::create_dir_all(&invalid_label)?;
        for (input, expected) in [
            (invalid_fixture.as_path(), "did not belong"),
            (invalid_label.as_path(), "did not match"),
        ] {
            let error = super::ValidatedAutomationDataDirectory::parse(
                super::WebViewAutomation::Enabled,
                automation_profile_arguments(Some(input)),
                Some(local_app_data.path().as_os_str()),
            )
            .expect_err("malformed automation profile was accepted");
            assert!(error.to_string().contains(expected));
        }

        let mut context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        super::apply_automation_data_directory(&mut context, None)?;
        context.config_mut().app.windows.clear();
        let error = super::apply_automation_data_directory(
            &mut context,
            Some(super::ValidatedAutomationDataDirectory {
                absolute: PathBuf::from("webview2-user-data"),
                relative: PathBuf::from("webview2-user-data"),
            }),
        )
        .expect_err("missing main automation window was accepted");
        assert!(error.to_string().contains("main automation window"));
        Ok(())
    }

    #[test]
    fn transports_validated_json_through_the_real_bridge() -> Result<(), Box<dyn std::error::Error>>
    {
        let sidecar = packaged_bridge_path()?;
        require_packaged_bridge(&sidecar)?;
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .invoke_handler(tauri::generate_handler![super::invoke_bridge])
            .build(mock_context(noop_assets()))?;
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;
        let response = get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "invoke_bridge".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse()?,
                body: InvokeBody::Json(json!({ "request": { "kind": "unknown" } })),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map_err(|error| std::io::Error::other(error.to_string()))?
        .deserialize::<serde_json::Value>()?;
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "INVALID_REQUEST");
        Ok(())
    }

    #[test]
    fn reports_a_missing_packaged_bridge() {
        let missing = std::env::temp_dir().join(format!(
            "oneharness-ui-bridge-that-does-not-exist-{}",
            std::process::id()
        ));
        let error = require_packaged_bridge(&missing).expect_err("missing sidecar was accepted");
        assert!(error.to_string().contains("tauri-build did not stage"));
    }

    #[test]
    fn reports_cleanup_failure_without_leaking_process_details() {
        let primary = "Local bridge response exceeded 4 MiB".to_string();
        assert_eq!(
            super::sanitized_cleanup_result(primary.clone(), Ok::<(), &str>(())),
            primary
        );
        let failure = super::sanitized_cleanup_result(
            primary,
            Err::<(), _>("sensitive operating-system detail"),
        );
        assert!(failure.contains("local bridge process could not be stopped"));
        assert!(!failure.contains("sensitive operating-system detail"));
    }

    #[test]
    fn rejects_oversized_requests_before_process_launch() -> Result<(), Box<dyn std::error::Error>>
    {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .build(mock_context(noop_assets()))?;
        let result = tauri::async_runtime::block_on(super::invoke_bridge(
            app.handle().clone(),
            super::BridgeRequest(json!({ "message": "x".repeat(super::MAX_REQUEST_BYTES) })),
        ));
        let error = result.expect_err("oversized input was accepted");
        assert!(error.contains("64 KiB"));
        Ok(())
    }

    #[test]
    fn reports_a_bridge_that_closes_its_input() -> Result<(), Box<dyn std::error::Error>> {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .build(mock_context(noop_assets()))?;
        let command = app.shell().command("sh").args(["-c", "exec 0<&-; sleep 1"]);
        let result = tauri::async_runtime::block_on(super::run_bridge_command(
            command,
            &vec![b'x'; 1024 * 1024],
        ));
        assert!(matches!(result, Err(message) if message.contains("Could not send")));
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
