# Releases the Windows app from this machine: build, installer, R2 publish.
# CI only builds and tests (and keeps an unsigned installer of each PR as an artifact).
#
#   scripts/release.ps1 prod     # BoringTalks → download.boringtalks.lol/BoringTalks-Setup-latest.exe
#   scripts/release.ps1 dev      # BoringTalks Dev (dev environment) → download.boringtalks.lol/dev/BoringTalks-Dev-Setup-latest.exe
#
# Env (defaults point at the gitignored .local/secrets of this repo, as for the Mac release):
#   R2_SECRETS     file with the R2 access key id and secret, one per line
#   BUILD_NUMBER   default: minutes since 2026-01-01
#   SIGN_PARAMS    signtool.exe arguments; once set, the build is code-signed and published as such
#
# Every release moves the patch up (scripts/next-version.mjs: one above what's live for that target,
# or Directory.Build.props when that's higher) and writes it back to Directory.Build.props: commit it.
# Installers and the app's updater only take a version newer than the one installed.
param([Parameter(Mandatory = $true)][ValidateSet('prod', 'dev')][string]$Target)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$root = (Resolve-Path '..\..').Path

$secrets = if ($env:R2_SECRETS) { $env:R2_SECRETS } else { Join-Path $root '.local\secrets\r2' }
if (-not (Test-Path $secrets)) { throw "no R2 secrets at $secrets (the access key id and secret, one per line)" }
$version = ([xml](Get-Content Directory.Build.props)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
$build = if ($env:BUILD_NUMBER) { $env:BUILD_NUMBER } else { [string][math]::Floor(((Get-Date).ToUniversalTime() - [datetime]'2026-01-01').TotalMinutes) }

$flavor, $setup = if ($Target -eq 'dev') { 'dev', 'BoringTalks-Dev-Setup' } else { 'release', 'BoringTalks-Setup' }
$prefix = if ($Target -eq 'dev') { 'dev/' } else { '' }
$next = node (Join-Path $root 'scripts/next-version.mjs') $version "https://download.boringtalks.lol/${prefix}latest-windows.json"
if ($LASTEXITCODE -ne 0 -or -not $next) { throw 'next-version.mjs failed' }
if ($next -ne $version) {
  $props = Get-Content Directory.Build.props -Raw
  [IO.File]::WriteAllText((Resolve-Path Directory.Build.props), ($props -replace "<Version>$([regex]::Escape($version))</Version>", "<Version>$next</Version>"), (New-Object Text.UTF8Encoding $false))
  Write-Host "version $version -> $next (Directory.Build.props; commit it)"
  $version = $next
}
& (Join-Path $PSScriptRoot 'build.ps1') -Version $version -Build $build -Flavor $flavor
Set-Content "build\$setup.build" $build

$keys = Get-Content $secrets
$env:R2_ACCESS_KEY_ID = $keys[0].Trim()
$env:R2_SECRET_ACCESS_KEY = $keys[1].Trim()
$env:R2_ENDPOINT = 'https://924ba8ce0dcdcd4e131bebe3dc05b84c.r2.cloudflarestorage.com'
$env:R2_DOWNLOADS_BUCKET = 'boringtalks'
$env:DOWNLOADS_BASE_URL = 'https://download.boringtalks.lol'
& (Join-Path $PSScriptRoot 'publish.ps1') -Exe "build\$setup.exe" -Feed "build\Releases\$flavor" -Name $setup -Version $version -Build $build -Signed ([bool]$env:SIGN_PARAMS) -Prefix $prefix
