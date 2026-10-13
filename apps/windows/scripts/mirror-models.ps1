# Copies the speech models the Windows app downloads (BoringTalks.Core/Speech/ModelCatalog.cs) to
# download.boringtalks.lol/models/, the first place the app looks; Hugging Face and the sherpa-onnx
# releases stay as fallbacks. Run once, and again when ModelCatalog changes.
#
#   scripts/mirror-models.ps1      # needs the AWS CLI and .local/secrets/r2, like release.ps1
param([string]$Models = (Join-Path $env:LOCALAPPDATA 'BoringTalks-Models'))
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$root = (Resolve-Path '..\..').Path
$secrets = if ($env:R2_SECRETS) { $env:R2_SECRETS } else { Join-Path $root '.local\secrets\r2' }
if (-not (Test-Path $secrets)) { throw "no R2 secrets at $secrets" }
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw 'the AWS CLI is missing: winget install Amazon.AWSCLI' }

# The app has downloaded and checked them (SHA-256) already; run it once (or --transcribe a file) first.
$files = 'parakeet-tdt-0.6b-v3-int8/encoder.int8.onnx', 'parakeet-tdt-0.6b-v3-int8/decoder.int8.onnx',
  'parakeet-tdt-0.6b-v3-int8/joiner.int8.onnx', 'parakeet-tdt-0.6b-v3-int8/tokens.txt',
  'pyannote-segmentation-3-0/model.onnx', 'titanet/nemo_en_titanet_small.onnx'
$keys = Get-Content $secrets
$env:AWS_ACCESS_KEY_ID = $keys[0].Trim()
$env:AWS_SECRET_ACCESS_KEY = $keys[1].Trim()
$env:AWS_DEFAULT_REGION = 'auto'
foreach ($file in $files) {
  $path = Join-Path $Models ($file -replace '/', '\')
  if (-not (Test-Path $path)) { throw "missing ${path}: start BoringTalks once so it downloads the models" }
  aws s3 cp $path "s3://boringtalks/downloads/models/$file" --endpoint-url 'https://924ba8ce0dcdcd4e131bebe3dc05b84c.r2.cloudflarestorage.com' `
    --cache-control 'public, max-age=31536000, immutable' --only-show-errors
  if ($LASTEXITCODE -ne 0) { throw "upload of $file failed" }
  Write-Host "https://download.boringtalks.lol/models/$file"
}
