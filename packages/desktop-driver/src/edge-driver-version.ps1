# Prints the four-part version msedgedriver reports. Current builds print
# "Microsoft Edge WebDriver <version> (<hash>)" and older ones "MSEdgeDriver
# <version>". PowerShell returns multi-line native output as an array, on which
# -match filters instead of capturing, so the output is joined first.
param([Parameter(Mandatory = $true)][string]$DriverPath)
$ErrorActionPreference = 'Stop'
$output = (@(& $DriverPath --version) -join "`n").Trim()
$code = $LASTEXITCODE
if ($code -eq 0 -and $output -match '(?:Microsoft Edge WebDriver|MSEdgeDriver) (\d+\.\d+\.\d+\.\d+)') {
  $Matches[1]
  exit 0
}
if ($output.Length -gt 200) { $output = $output.Substring(0, 200) + '...' }
throw "msedgedriver at $DriverPath did not report its version (exit $code); it printed '$output'"
