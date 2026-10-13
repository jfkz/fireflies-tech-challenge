# Builds the Windows app and its installer.
#
#   scripts/build.ps1                               # version from Directory.Build.props
#   scripts/build.ps1 -Version 0.1.0 -Build 406080  # what release.ps1 passes
#   scripts/build.ps1 -SkipInstaller                # just the self-contained app in build\publish
#
# Output:
#   build\publish\                     the app (self-contained .NET, win-x64)
#   build\Releases\                    Velopack's packages (full .nupkg, releases.win.json) for updates
#   build\BoringTalks-Setup.exe        the per-user installer people download
#
# Signing: unsigned for now. Set SIGN_PARAMS (signtool.exe arguments, e.g. "/a /fd sha256 /tr <url> /td sha256")
# and Velopack signs the app and the installer with it.
param(
  [string]$Version,
  [string]$Build = '0',
  [switch]$SkipInstaller
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not $Version) {
  $Version = ([xml](Get-Content Directory.Build.props)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
}
if ($Version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') { throw "not a version: $Version" }
if ($Build -notmatch '^[0-9A-Za-z.-]+$') { throw "not a build number: $Build" }

$publish = 'build\publish'
if (Test-Path $publish) { Remove-Item -Recurse -Force $publish }
dotnet publish src/BoringTalks.App -c Release -r win-x64 --self-contained -o $publish `
  "-p:Version=$Version" "-p:InformationalVersion=$Version+$Build" "-p:FileVersion=$($Version -replace '[-+].*$', '').0"
if ($LASTEXITCODE -ne 0) { throw 'publish failed' }
if ($SkipInstaller) { return }

dotnet tool restore
if ($LASTEXITCODE -ne 0) { throw 'dotnet tool restore failed' }
$pack = @(
  'pack', '--packId', 'BoringTalks', '--packVersion', $Version, '--packDir', $publish,
  '--mainExe', 'BoringTalks.exe', '--packTitle', 'BoringTalks', '--packAuthors', 'BoringTalks',
  '--icon', 'assets\BoringTalks.ico', '--outputDir', 'build\Releases', '--delta', 'None'
)
if ($env:SIGN_PARAMS) { $pack += @('--signParams', $env:SIGN_PARAMS) }
dotnet vpk @pack
if ($LASTEXITCODE -ne 0) { throw 'vpk pack failed' }

Copy-Item 'build\Releases\BoringTalks-win-Setup.exe' 'build\BoringTalks-Setup.exe' -Force
$size = (Get-Item 'build\BoringTalks-Setup.exe').Length
Write-Host ("build\BoringTalks-Setup.exe  {0:N1} MB  version {1} ({2})" -f ($size / 1MB), $Version, $Build)
