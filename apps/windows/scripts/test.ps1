# Unit tests (BoringTalks.Core, with the coverage gate) and a Release build of the app.
#
#   scripts/test.ps1                 # what CI runs
#   scripts/test.ps1 -Threshold 0    # without the coverage gate
#
# Works in Windows PowerShell 5.1 and PowerShell 7.
param([int]$Threshold = 80)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$results = Join-Path (Get-Location) 'build\TestResults'
dotnet test --project tests/BoringTalks.Core.Tests -c Release --results-directory $results `
  --coverlet --coverlet-include '[BoringTalks.Core]*' --coverlet-output-format cobertura --coverlet-threshold $Threshold
if ($LASTEXITCODE -ne 0) { throw "tests failed (or Core line coverage is under $Threshold%)" }

dotnet build src/BoringTalks.App -c Release
if ($LASTEXITCODE -ne 0) { throw 'the app did not build' }
