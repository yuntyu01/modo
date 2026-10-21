param([string]$SdkVersion='', [switch]$Prepare)
$ErrorActionPreference='Stop'
$desktopPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath=Join-Path $desktopPath 'dist/__appx-x64/AppxManifest.xml'
$mappingPath=Join-Path $desktopPath 'dist/__appx-x64/mapping.txt'
$outputPath=Join-Path $desktopPath 'dist/modo-1.0.0-store-x64.appx'
foreach ($name in @('MODO_STORE_IDENTITY','MODO_STORE_PUBLISHER','MODO_STORE_PUBLISHER_NAME')) {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Missing $name from Partner Center" }
}
if ($Prepare) {
  $prepared = & node (Join-Path $PSScriptRoot 'prepare-store-sdk.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'SDK manifest preparation failed' }
  $package = $prepared | ConvertFrom-Json
  $manifestPath=$package.manifest
  $mappingPath=$package.mapping
  $outputPath=$package.output
}
if (-not (Test-Path -LiteralPath $mappingPath)) { throw 'Generate the AppX manifest and mapping with electron-builder first.' }
[xml]$manifest=Get-Content -LiteralPath $manifestPath -Raw
if ($manifest.Package.Identity.Name -ne $env:MODO_STORE_IDENTITY -or
    $manifest.Package.Identity.Publisher -ne $env:MODO_STORE_PUBLISHER -or
    $manifest.Package.Properties.PublisherDisplayName -ne $env:MODO_STORE_PUBLISHER_NAME) {
  throw 'Generated manifest does not match the real Partner Center identity.'
}
$sdkBase=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
if (-not $SdkVersion) {
  $installedSdk=Get-ChildItem -LiteralPath $sdkBase -Directory |
    Where-Object { $_.Name -match '^10\.0\.\d+\.\d+$' -and
      (Test-Path -LiteralPath (Join-Path $_.FullName 'x64/makeappx.exe')) -and
      (Test-Path -LiteralPath (Join-Path $_.FullName 'x64/makepri.exe')) } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
  if (-not $installedSdk) { throw 'Install the official Microsoft Windows SDK with MakeAppx and MakePri first.' }
  $SdkVersion=$installedSdk.Name
  Write-Host "Using installed official Windows SDK $SdkVersion"
}
$makeAppx=Join-Path $sdkBase "$SdkVersion/x64/makeappx.exe"
if (-not (Test-Path -LiteralPath $makeAppx)) { throw "Install the Microsoft Windows SDK $SdkVersion first." }
if ($Prepare) {
  $makePri=Join-Path $sdkBase "$SdkVersion/x64/makepri.exe"
  if (-not (Test-Path -LiteralPath $makePri)) { throw "Missing official SDK MakePri: $SdkVersion" }
  & $makePri new /o /pr $package.priRoot /cf $package.priConfig /mn $manifestPath /of $package.pri
  if ($LASTEXITCODE -ne 0) { throw "Microsoft MakePri failed: $LASTEXITCODE" }
}
# Keep MakeAppx schema/content validation enabled. Do not use /nv.
& $makeAppx pack /o /f $mappingPath /p $outputPath
if ($LASTEXITCODE -ne 0) { throw "Microsoft MakeAppx failed: $LASTEXITCODE" }
