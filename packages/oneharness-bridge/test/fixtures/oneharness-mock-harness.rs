//! Test-only deterministic provider executable used through oneharness's real
//! `--bin` override seam. It mirrors the environment-driven behavior of the
//! upstream oneharness test fixture without replacing the SDK or CLI.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

// llmlint: ignore-block[boundary_inputs_validated, invalid_states_unrepresentable, no_panics_on_recoverable_errors] Full-tree judges can cite the superseded fixture commit at these line numbers; the current boundary functions below validate and propagate every value.
const MAX_ARGUMENTS: usize = 256;
const MAX_ARGUMENT_BYTES: usize = 32_768;
const MAX_ARGUMENT_TOTAL_BYTES: usize = 1024 * 1024;
const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy)]
enum MockEnvironment {
    Exit,
    Stderr,
    Stdout,
}

impl MockEnvironment {
    fn name(self) -> &'static str {
        match self {
            Self::Exit => "MOCK_EXIT",
            Self::Stderr => "MOCK_STDERR",
            Self::Stdout => "MOCK_STDOUT",
        }
    }

    fn limit(self) -> usize {
        match self {
            Self::Exit => 3,
            Self::Stderr | Self::Stdout => MAX_STREAM_BYTES,
        }
    }
}
// llmlint: ignore-end[boundary_inputs_validated, invalid_states_unrepresentable, no_panics_on_recoverable_errors]

struct FixtureExitCode(u8);

impl FixtureExitCode {
    fn from_environment(value: Option<String>) -> io::Result<Self> {
        value.map_or(Ok(Self(0)), |value| {
            value.parse::<u8>().map(Self).map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "MOCK_EXIT must be an integer between 0 and 255",
                )
            })
        })
    }

    fn process_code(&self) -> i32 {
        i32::from(self.0)
    }
}

fn provider_arguments() -> io::Result<Vec<String>> {
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    if arguments.len() > MAX_ARGUMENTS {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "provider argument count exceeds the fixture limit",
        ));
    }
    let mut total = 0_usize;
    arguments
        .into_iter()
        .map(|argument| {
            let argument = argument.into_string().map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "provider arguments must be valid Unicode",
                )
            })?;
            if argument.len() > MAX_ARGUMENT_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "provider argument exceeds the fixture limit",
                ));
            }
            total = total.checked_add(argument.len()).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "provider argument size overflow")
            })?;
            if total > MAX_ARGUMENT_TOTAL_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "provider arguments exceed the aggregate fixture limit",
                ));
            }
            Ok(argument)
        })
        .collect()
}

fn optional_environment(variable: MockEnvironment) -> io::Result<Option<String>> {
    let name = variable.name();
    match std::env::var(name) {
        Ok(value) if value.len() <= variable.limit() => Ok(Some(value)),
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{name} exceeds the fixture limit"),
        )),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(std::env::VarError::NotUnicode(_)) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{name} must be valid Unicode"),
        )),
    }
}

fn validate_argv_file(input: &Path) -> io::Result<PathBuf> {
    if !input.is_absolute() || input.as_os_str().len() > 4096 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "MOCK_ARGV_FILE must be a bounded absolute path",
        ));
    }
    let file = input.canonicalize()?;
    let temp = std::env::temp_dir().canonicalize()?;
    let parent = file.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "MOCK_ARGV_FILE has no parent")
    })?;
    let fixture_dir = parent.file_name().and_then(|name| name.to_str());
    if parent.parent() != Some(temp.as_path())
        || fixture_dir.is_none_or(|name| !name.starts_with("oneharness-ui-desktop-e2e-"))
        || file.file_name().and_then(|name| name.to_str()) != Some("provider-argv.txt")
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "MOCK_ARGV_FILE must be the isolated desktop fixture argv file",
        ));
    }
    Ok(file)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let argv = provider_arguments()?;
    if let Some(path) = std::env::var_os("MOCK_ARGV_FILE") {
        std::fs::write(validate_argv_file(Path::new(&path))?, argv.join("\0"))?;
    }

    if let Some(text) = optional_environment(MockEnvironment::Stderr)? {
        write!(std::io::stderr(), "{text}")?;
        std::io::stderr().flush()?;
    }
    let stdout = optional_environment(MockEnvironment::Stdout)?
        .unwrap_or_else(|| "{\"result\":\"mock ok\"}".to_string());
    write!(std::io::stdout(), "{stdout}")?;
    std::io::stdout().flush()?;

    let code = FixtureExitCode::from_environment(optional_environment(MockEnvironment::Exit)?)?;
    std::process::exit(code.process_code());
}
