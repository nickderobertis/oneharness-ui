# Prints the msedgedriver download suffix for this OS. The journey runs with an
# allowlisted environment that omits PROCESSOR_ARCHITECTURE, so ask the runtime
# first and use the environment only where the runtime cannot answer.
$ErrorActionPreference = 'Stop'
$processor = $null
try { $processor = [string][System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture } catch { }
if (-not $processor) { $processor = $env:PROCESSOR_ARCHITEW6432 }
if (-not $processor) { $processor = $env:PROCESSOR_ARCHITECTURE }
switch ($processor) {
  { $_ -in 'X64', 'AMD64' } { 'win64'; break }
  'Arm64' { 'arm64'; break }
  'X86' { 'win32'; break }
  default { throw "msedgedriver has no configured download for Windows architecture '$processor'" }
}
