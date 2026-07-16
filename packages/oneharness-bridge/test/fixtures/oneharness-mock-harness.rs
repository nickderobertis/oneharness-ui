//! Test-only deterministic provider executable used through oneharness's real
//! `--bin` override seam. It mirrors the environment-driven behavior of the
//! upstream oneharness test fixture without replacing the SDK or CLI.

use std::io::Write;

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if let Ok(path) = std::env::var("MOCK_ARGV_FILE") {
        let _ = std::fs::write(path, argv.join("\n"));
    }

    if let Ok(text) = std::env::var("MOCK_STDERR") {
        let _ = write!(std::io::stderr(), "{text}");
        let _ = std::io::stderr().flush();
    }
    let stdout = std::env::var("MOCK_STDOUT")
        .unwrap_or_else(|_| "{\"result\":\"mock ok\"}".to_string());
    let _ = write!(std::io::stdout(), "{stdout}");
    let _ = std::io::stdout().flush();

    let code = std::env::var("MOCK_EXIT")
        .ok()
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(0);
    std::process::exit(code);
}
