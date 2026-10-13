# Releases the Windows app from this machine: build, installer, R2 publish.
# CI only builds and tests (and keeps an unsigned installer of each PR as an artifact).
#
#   scripts/release.ps1 prod     # BoringTalks → download.boringtalks.lol/BoringTalks-Setup-latest.exe
#   scripts/release.ps1 dev      # BoringTalks Dev (dev environment) → download.boringtalks.lol/dev/BoringTalks-Dev-Setup-latest.exe
#
# Env (defaults point at the gitignored .local/secrets of this repo, as for the Mac release):
#   R2_SECRETS     file with the R2 access key id and secret, one per line
#   BUILD_NUMBER   default: minutes since 2026-01-01
#   FORCE          1: publish to prod even if that version is already out (installed apps then don't update)
#
# Installed apps update themselves only to a higher version. Dev builds are "<Version>-dev.<build>",
# so every one is newer; prod needs Version in Directory.Build.props bumped for each release.
#   SIGN_PARAMS    signtool.exe arguments; once set, the build is code-signed and published as such
param([Parameter(Mandatory = $true)][ValidateSet('prod', 'dev')][string]$Target)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$root = (Resolve-Path '..\..').Path

$secrets = if ($env:R2_SECRETS) { $env:R2_SECRETS } else { Join-Path $root '.local\secrets\r2' }
if (-not (Test-Path $secrets)) { throw "no R2 secrets at $secrets (the access key id and secret, one per line)" }
$version = ([xml](Get-Content Directory.Build.props)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
$build = if ($env:BUILD_NUMBER) { $env:BUILD_NUMBER } else { [string][math]::Floor(((Get-Date).ToUniversalTime() - [datetime]'2026-01-01').TotalMinutes) }

$flavor, $setup = if ($Target -eq 'dev') { 'dev', 'BoringTalks-Dev-Setup' } else { 'release', 'BoringTalks-Setup' }
if ($Target -eq 'dev') {
  $version = "$version-dev.$build"
}
else {
  # The version that's out now; the new one must be higher or nobody gets it.
  try {
    $live = (Invoke-RestMethod 'https://download.boringtalks.lol/latest-windows.json' -TimeoutSec 20).version
  }
  catch {
    $live = $null
  }
  if ($live -and [version]($live -replace '[-+].*$', '') -ge [version]$version -and $env:FORCE -ne '1') {
    throw "$version isn't newer than $live, which is out already: bump Version in Directory.Build.props (or FORCE=1)"
  }
}
& (Join-Path $PSScriptRoot 'build.ps1') -Version $version -Build $build -Flavor $flavor
Set-Content "build\$setup.build" $build

$keys = Get-Content $secrets
$env:R2_ACCESS_KEY_ID = $keys[0].Trim()
$env:R2_SECRET_ACCESS_KEY = $keys[1].Trim()
$env:R2_ENDPOINT = 'https://924ba8ce0dcdcd4e131bebe3dc05b84c.r2.cloudflarestorage.com'
$env:R2_DOWNLOADS_BUCKET = 'boringtalks'
$env:DOWNLOADS_BASE_URL = 'https://download.boringtalks.lol'
$prefix = if ($Target -eq 'dev') { 'dev/' } else { '' }
& (Join-Path $PSScriptRoot 'publish.ps1') -Exe "build\$setup.exe" -Feed "build\Releases\$flavor" -Name $setup -Version $version -Build $build -Signed ([bool]$env:SIGN_PARAMS) -Prefix $prefix
