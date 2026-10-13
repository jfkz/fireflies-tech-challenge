# Uploads the Windows installer and latest-windows.json to the public downloads bucket
# (Cloudflare R2, S3 API), next to the Mac DMGs.
#
#   scripts/publish.ps1 build\BoringTalks-Setup.exe 0.5.0 406080 -Signed:$false          # production
#   scripts/publish.ps1 build\BoringTalks-Dev-Setup.exe 0.5.0 406080 -Signed:$false -Prefix dev/ -Name BoringTalks-Dev-Setup
#
# Env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_DOWNLOADS_BUCKET,
#      DOWNLOADS_BASE_URL (e.g. https://download.boringtalks.lol),
#      R2_DOWNLOADS_KEY_PREFIX (default "downloads/": the folder of the shared bucket
#      that download.boringtalks.lol serves).
# Writes <key prefix>[prefix]<name>-<version>.exe, …<name>-latest.exe and
# …latest-windows.json, whose shape is LatestDownload in packages/shared/src/user.ts. With -Feed
# (build.ps1's build\Releases\<flavor>), also the update feed the installed apps check:
# …updates/windows/<package>.nupkg, then …updates/windows/releases.win.json.
# Uploads with the AWS CLI when it's installed (winget install Amazon.AWSCLI), otherwise with
# scripts/r2-put.mjs (Node and the API's S3 SDK: pnpm install at the repo root).
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  # Velopack's output folder: releases.win.json and the full package.
  [string]$Feed = '',
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Build,
  [bool]$Signed = $false,
  [string]$Prefix = '',
  # BoringTalks-Setup, or BoringTalks-Dev-Setup for BoringTalks Dev.
  [ValidatePattern('^[A-Za-z0-9-]+$')][string]$Name = 'BoringTalks-Setup'
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Exe)) { throw "no installer at $Exe" }
if ($Version -notmatch '^[0-9A-Za-z.+-]+$' -or $Build -notmatch '^[0-9A-Za-z.+-]+$') { throw 'bad version or build' }
foreach ($variable in 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_DOWNLOADS_BUCKET', 'DOWNLOADS_BASE_URL') {
  if (-not [Environment]::GetEnvironmentVariable($variable)) { throw "$variable is not set" }
}
$useCli = [bool](Get-Command aws -ErrorAction SilentlyContinue)
$putScript = Join-Path $PSScriptRoot 'r2-put.mjs'
if (-not $useCli -and -not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'neither the AWS CLI (winget install Amazon.AWSCLI) nor Node is installed' }
# "dev", "/dev", "dev/" → "dev/"
$Prefix = $Prefix.TrimStart('/')
if ($Prefix -and -not $Prefix.EndsWith('/')) { $Prefix += '/' }
$keyPrefix = if ($env:R2_DOWNLOADS_KEY_PREFIX) { $env:R2_DOWNLOADS_KEY_PREFIX } else { 'downloads/' }

$env:AWS_ACCESS_KEY_ID = $env:R2_ACCESS_KEY_ID
$env:AWS_SECRET_ACCESS_KEY = $env:R2_SECRET_ACCESS_KEY
$env:AWS_DEFAULT_REGION = 'auto'
$folder = "$keyPrefix$Prefix"
$file = "$Name-$Version.exe"
$base = $env:DOWNLOADS_BASE_URL.TrimEnd('/')

function Upload([string]$From, [string]$To, [string]$Type, [int]$MaxAge) {
  if ($useCli) {
    aws s3 cp $From "s3://$($env:R2_DOWNLOADS_BUCKET)/$folder$To" --endpoint-url $env:R2_ENDPOINT --content-type $Type --cache-control "public, max-age=$MaxAge" --only-show-errors
  }
  else {
    node $putScript $From $env:R2_DOWNLOADS_BUCKET "$folder$To" $Type $MaxAge
  }
  if ($LASTEXITCODE -ne 0) { throw "upload of $To failed" }
}

Upload $Exe $file 'application/vnd.microsoft.portable-executable' 3600
Upload $Exe "$Name-latest.exe" 'application/vnd.microsoft.portable-executable' 300

if ($Feed) {
  $index = Join-Path $Feed 'releases.win.json'
  if (-not (Test-Path $index)) { throw "no releases.win.json in $Feed" }
  # The packages first, so the index never names one that isn't there yet.
  foreach ($package in Get-ChildItem $Feed -Filter '*.nupkg') {
    Upload $package.FullName "updates/windows/$($package.Name)" 'application/octet-stream' 86400
  }
  Upload $index 'updates/windows/releases.win.json' 'application/json' 60
}

$latest = [ordered]@{
  platform    = 'windows'
  version     = $Version
  build       = $Build
  url         = "$base/$Prefix$file"
  sizeBytes   = (Get-Item $Exe).Length
  minimumOs   = '10.0.19041'
  notarized   = $Signed
  publishedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.000'Z'")
}
$json = Join-Path ([IO.Path]::GetTempPath()) "latest-windows-$PID.json"
[IO.File]::WriteAllText($json, ($latest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
try {
  Upload $json 'latest-windows.json' 'application/json' 60
}
finally {
  Remove-Item $json -ErrorAction SilentlyContinue
}
Write-Host "published $($latest.url) ($([math]::Round($latest.sizeBytes / 1MB, 1)) MB) and $base/${Prefix}latest-windows.json"
if ($Feed) { Write-Host "update feed: $base/${Prefix}updates/windows/releases.win.json" }
