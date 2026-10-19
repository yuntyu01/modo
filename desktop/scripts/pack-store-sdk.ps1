param([string]$SdkVersion='10.0.19041.0')
$ErrorActionPreference='Stop'
$desktopPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath=Join-Path $desktopPath 'dist/__appx-x64/AppxManifest.xml'
$mappingPath=Join-Path $desktopPath 'dist/__appx-x64/mapping.txt'
$outputPath=Join-Path $desktopPath 'dist/modo-1.0.0-store-x64.appx'
foreach ($name in @('MODO_STORE_IDENTITY','MODO_STORE_PUBLISHER','MODO_STORE_PUBLISHER_NAME')) {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Missing $name from Partner Center" }
}
if (-not (Test-Path -LiteralPath $mappingPath)) { throw 'Generate the AppX manifest and mapping with electron-builder first.' }
[xml]$manifest=Get-Content -LiteralPath $manifestPath -Raw
if ($manifest.Package.Identity.Name -ne $env:MODO_STORE_IDENTITY -or
    $manifest.Package.Identity.Publisher -ne $env:MODO_STORE_PUBLISHER -or
    $manifest.Package.Properties.PublisherDisplayName -ne $env:MODO_STORE_PUBLISHER_NAME) {
  throw 'Generated manifest does not match the real Partner Center identity.'
}
$sdkBase=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$makeAppx=Join-Path $sdkBase "$SdkVersion/x64/makeappx.exe"
if (-not (Test-Path -LiteralPath $makeAppx)) { throw "Install the Microsoft Windows SDK $SdkVersion first." }
# Keep MakeAppx schema/content validation enabled. Do not use /nv.
& $makeAppx pack /o /f $mappingPath /p $outputPath
if ($LASTEXITCODE -ne 0) { throw "Microsoft MakeAppx failed: $LASTEXITCODE" }
