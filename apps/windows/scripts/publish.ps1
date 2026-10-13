# Uploads the Windows installer and latest-windows.json to the public downloads bucket
# (Cloudflare R2, S3 API), next to the Mac DMGs.
#
#   scripts/publish.ps1 build\BoringTalks-Setup.exe 0.1.0 406080 -Signed:$false          # production
#   scripts/publish.ps1 build\BoringTalks-Setup.exe 0.1.0 406080 -Signed:$false -Prefix dev/
#
# Env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_DOWNLOADS_BUCKET,
#      DOWNLOADS_BASE_URL (e.g. https://download.boringtalks.lol),
#      R2_DOWNLOADS_KEY_PREFIX (default "downloads/": the folder of the shared bucket
#      that download.boringtalks.lol serves).
# Writes <key prefix>[prefix]BoringTalks-Setup-<version>.exe, …BoringTalks-Setup-latest.exe and
# …latest-windows.json, whose shape is LatestDownload in packages/shared/src/user.ts.
# Needs the AWS CLI (winget install Amazon.AWSCLI).
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Build,
  [bool]$Signed = $false,
  [string]$Prefix = ''
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Exe)) { throw "no installer at $Exe" }
if ($Version -notmatch '^[0-9A-Za-z.+-]+$' -or $Build -notmatch '^[0-9A-Za-z.+-]+$') { throw 'bad version or build' }
foreach ($name in 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_DOWNLOADS_BUCKET', 'DOWNLOADS_BASE_URL') {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "$name is not set" }
}
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw 'the AWS CLI is missing: winget install Amazon.AWSCLI' }
# "dev", "/dev", "dev/" → "dev/"
$Prefix = $Prefix.TrimStart('/')
if ($Prefix -and -not $Prefix.EndsWith('/')) { $Prefix += '/' }
$keyPrefix = if ($env:R2_DOWNLOADS_KEY_PREFIX) { $env:R2_DOWNLOADS_KEY_PREFIX } else { 'downloads/' }

$env:AWS_ACCESS_KEY_ID = $env:R2_ACCESS_KEY_ID
$env:AWS_SECRET_ACCESS_KEY = $env:R2_SECRET_ACCESS_KEY
$env:AWS_DEFAULT_REGION = 'auto'
$bucket = "s3://$($env:R2_DOWNLOADS_BUCKET)/$keyPrefix$Prefix"
$name = "BoringTalks-Setup-$Version.exe"
$base = $env:DOWNLOADS_BASE_URL.TrimEnd('/')

function Upload([string]$From, [string]$To, [string]$Type, [int]$MaxAge) {
  aws s3 cp $From "$bucket$To" --endpoint-url $env:R2_ENDPOINT --content-type $Type --cache-control "public, max-age=$MaxAge" --only-show-errors
  if ($LASTEXITCODE -ne 0) { throw "upload of $To failed" }
}

Upload $Exe $name 'application/vnd.microsoft.portable-executable' 3600
Upload $Exe 'BoringTalks-Setup-latest.exe' 'application/vnd.microsoft.portable-executable' 300

$latest = [ordered]@{
  platform    = 'windows'
  version     = $Version
  build       = $Build
  url         = "$base/$Prefix$name"
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
