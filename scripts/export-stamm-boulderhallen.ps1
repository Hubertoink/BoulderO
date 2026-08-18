param(
  [string]$SourcePath = (Join-Path $PSScriptRoot '..\assets\Unsere Boulderreise.xlsx'),
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\data\StammBoulderhallen.csv'),
  [string[]]$ExcludeName = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-ColumnIndex([string]$Reference) {
  $letters = $Reference -replace '\d', ''
  $result = 0
  foreach ($character in $letters.ToCharArray()) {
    $result = ($result * 26) + ([int][char]::ToUpperInvariant($character) - 64)
  }
  return $result - 1
}

function Get-CellValue($Cell, [string[]]$SharedStrings) {
  $valueNode = $Cell.SelectSingleNode('./*[local-name()="v"]')
  if (-not $valueNode) {
    $inlineString = $Cell.SelectSingleNode('./*[local-name()="is"]')
    if ($inlineString) { return $inlineString.InnerText }
    return ''
  }

  $value = $valueNode.InnerText
  if ($Cell.GetAttribute('t') -eq 's' -and $value -match '^\d+$') {
    return $SharedStrings[[int]$value]
  }
  return $value
}

function ConvertTo-Coordinate([string]$Value, [string]$ColumnName, [string]$HallName) {
  $normalized = $Value.Trim().TrimEnd(',').Trim()
  [double]$coordinate = 0
  if (-not [double]::TryParse($normalized, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$coordinate)) {
    throw "Ungültiger $ColumnName für '$HallName': $Value"
  }
  return $coordinate.ToString('0.###############', [Globalization.CultureInfo]::InvariantCulture)
}

function ConvertTo-Website([string]$Value) {
  $candidate = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }
  [uri]$uri = $null
  if ([uri]::TryCreate($candidate, [UriKind]::Absolute, [ref]$uri) -and $uri.Scheme -in @('http', 'https')) {
    return $candidate
  }
  return ''
}

$resolvedSource = (Resolve-Path -LiteralPath $SourcePath).Path
$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedSource)
try {
  $sharedEntry = $archive.GetEntry('xl/sharedStrings.xml')
  if (-not $sharedEntry) { throw 'Die Arbeitsmappe enthält keine Shared Strings.' }
  $reader = [System.IO.StreamReader]::new($sharedEntry.Open())
  try { [xml]$sharedXml = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $sharedStrings = @($sharedXml.SelectNodes('//*[local-name()="si"]') | ForEach-Object { $_.InnerText })

  $hallSheet = $archive.GetEntry('xl/worksheets/sheet1.xml')
  if (-not $hallSheet) { throw 'Das Tabellenblatt Hallen wurde nicht gefunden.' }
  $reader = [System.IO.StreamReader]::new($hallSheet.Open())
  try { [xml]$sheetXml = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $rows = @($sheetXml.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]'))
} finally {
  $archive.Dispose()
}

if ($rows.Count -lt 2) { throw 'Die Hallentabelle enthält keine Datensätze.' }

$headers = @('') * 15
foreach ($cell in $rows[0].SelectNodes('./*[local-name()="c"]')) {
  $headers[(Get-ColumnIndex $cell.r)] = Get-CellValue $cell $sharedStrings
}
$requiredHeaders = @('Hallen_ID', 'Name', 'Strasse', 'PLZ', 'Ort', 'Latitude', 'Longitude', 'Website')
foreach ($header in $requiredHeaders) {
  if ($headers -notcontains $header) { throw "Pflichtspalte fehlt: $header" }
}

$column = @{}
for ($index = 0; $index -lt $headers.Count; $index++) { $column[$headers[$index]] = $index }
$spots = @($rows | Select-Object -Skip 1 | ForEach-Object {
  $row = $_
  $values = @('') * $headers.Count
  foreach ($cell in $row.SelectNodes('./*[local-name()="c"]')) {
    $index = Get-ColumnIndex $cell.r
    if ($index -lt $values.Count) { $values[$index] = Get-CellValue $cell $sharedStrings }
  }

  $name = $values[$column.Name].Trim()
  $city = $values[$column.Ort].Trim()
  $street = $values[$column.Strasse].Trim()
  $postalCode = $values[$column.PLZ].Trim()
  if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($city) -or [string]::IsNullOrWhiteSpace($street) -or [string]::IsNullOrWhiteSpace($postalCode)) {
    throw "Unvollständige Adressdaten in Excel-Zeile $($row.r)."
  }

  $sourceExternalId = $values[$column.Hallen_ID].Trim()
  if ([string]::IsNullOrWhiteSpace($sourceExternalId)) { throw "Fehlende Hallen_ID in Excel-Zeile $($row.r)." }
  [pscustomobject]@{
    source_external_id = $sourceExternalId
    name          = $name
    district      = $city
    address       = "$street, $postalCode $city"
    latitude      = ConvertTo-Coordinate $values[$column.Latitude] 'Breitengrad' $name
    longitude     = ConvertTo-Coordinate $values[$column.Longitude] 'Längengrad' $name
    opening_hours = ''
    area_sqm      = ''
    website       = ConvertTo-Website $values[$column.Website]
    image_url     = ''
  }
})

$duplicates = $spots | Group-Object { "$($_.name.ToLowerInvariant())|$($_.address.ToLowerInvariant())" } | Where-Object Count -gt 1
if ($duplicates) { throw "Doppelte Hallen gefunden: $($duplicates.Name -join '; ')" }

# Die Quell-Arbeitsmappe enthält einige doppelt vergebene Hallen_IDs. Der
# deterministische Suffix macht sie für PostgreSQL eindeutig, ohne Hallen zu
# verwerfen oder bei einem erneuten Deployment gegenseitig zu überschreiben.
foreach ($group in ($spots | Group-Object source_external_id | Where-Object Count -gt 1)) {
  $sequence = 1
  foreach ($spot in $group.Group) {
    $spot.source_external_id = "$($spot.source_external_id)-$sequence"
    $sequence += 1
  }
}

$exportSpots = @($spots | Where-Object { $_.name -notin $ExcludeName })

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$exportSpots | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding utf8

$missingWebsites = @($exportSpots | Where-Object { -not $_.website }).Count
Write-Output "Exportiert: $($exportSpots.Count) Hallen nach $OutputPath"
Write-Output "Ohne verwendbare Website: $missingWebsites"
