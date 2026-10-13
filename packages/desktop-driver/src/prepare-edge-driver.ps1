$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Assert-MicrosoftDriver([string]$Path) {
  $signature = Get-AuthenticodeSignature -FilePath $Path
  if ($signature.Status -ne 'Valid' -or
      $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
    throw "msedgedriver publisher verification failed at $Path ($($signature.Status)); require a valid Microsoft Corporation signature"
  }
}
# Tauri hosts WebView2, whose version can differ from the Edge browser.
$runtime = @(
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
) | ForEach-Object { if (Test-Path $_) { (Get-ItemProperty $_).pv } } | Select-Object -First 1
if ($runtime -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'WebView2 runtime version is absent or invalid; install WebView2' }
$major = $runtime.Split('.')[0]
$readVersion = Join-Path $PSScriptRoot 'edge-driver-version.ps1'
$existing = Get-Command msedgedriver.exe -CommandType Application -ErrorAction SilentlyContinue
if ($existing) {
  Assert-MicrosoftDriver $existing.Source
  $version = $null
  try { $version = & $readVersion $existing.Source } catch { [Console]::Error.WriteLine("ignoring PATH msedgedriver: $_") }
  if ($version -and $version.Split('.')[0] -eq $major) {
    @{ path = $existing.Source; version = $version } | ConvertTo-Json -Compress
    exit 0
  }
  if ($version) { [Console]::Error.WriteLine("ignoring PATH msedgedriver $version at $($existing.Source); WebView2 is $runtime") }
}
$architecture = & (Join-Path $PSScriptRoot 'edge-driver-architecture.ps1')
$directory = Join-Path ([System.IO.Path]::GetTempPath()) ('oneharness-msedgedriver-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $directory | Out-Null
try {
  # Retry transient CDN failures; no journey can start without this file.
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      $version = $runtime
      try {
        $lookup = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri "https://msedgedriver.microsoft.com/LATEST_RELEASE_$major"
        # Microsoft's release text may carry a UTF-16 BOM. Decode the stream,
        # rather than treating a binary Content value as a version string.
        $reader = [System.IO.StreamReader]::new($lookup.RawContentStream)
        try { $latest = $reader.ReadToEnd().Trim() } finally { $reader.Dispose() }
        if ($latest -match '^\d+\.\d+\.\d+\.\d+$' -and $latest.Split('.')[0] -eq $major) { $version = $latest }
      } catch { [Console]::Error.WriteLine("msedgedriver version lookup failed; trying WebView2 version $runtime") }
      $archive = Join-Path $directory 'driver.zip'
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri "https://msedgedriver.microsoft.com/$version/edgedriver_$architecture.zip" -OutFile $archive
      Expand-Archive -Force -Path $archive -DestinationPath $directory
      $driver = Join-Path $directory 'msedgedriver.exe'
      Assert-MicrosoftDriver $driver
      $installed = & $readVersion $driver
      if ($installed.Split('.')[0] -ne $major) { throw "msedgedriver $installed does not match WebView2 $runtime" }
      @{ path = $driver; version = $installed } | ConvertTo-Json -Compress
      exit 0
    } catch {
      if ($attempt -eq 3) { throw "msedgedriver for WebView2 $runtime unavailable after $attempt attempts: $_" }
      [Console]::Error.WriteLine("msedgedriver attempt $attempt failed: $_")
    }
  }
} catch {
  Remove-Item -Recurse -Force $directory
  throw
}
