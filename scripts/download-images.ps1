# Downloads every product photo listed in seed/products.json into seed/images/.
# Run by double-clicking DOWNLOAD-IMAGES.bat in the project folder.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'seed\download-log.txt'
"started $(Get-Date)" | Out-File $log
$out  = Join-Path $root 'seed\images'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$data = Get-Content (Join-Path $root 'seed\products.json') -Raw | ConvertFrom-Json

$urls = New-Object System.Collections.Generic.List[string]
foreach ($p in $data.products) {
  foreach ($u in $p.images) { if (-not $urls.Contains($u)) { $urls.Add($u) } }
  foreach ($v in $p.variants) { if ($v.image -and -not $urls.Contains($v.image)) { $urls.Add($v.image) } }
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'; 'Referer' = 'https://www.aliexpress.us/' }
$ok = 0; $skip = 0; $fail = 0; $i = 0
foreach ($u in $urls) {
  $i++
  $name = ($u -split '/')[-1]
  $dest = Join-Path $out $name
  if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 1000)) { $skip++; continue }
  Write-Progress -Activity 'Downloading product photos' -Status "$i of $($urls.Count): $name" -PercentComplete (100 * $i / $urls.Count)
  $done = $false
  foreach ($attempt in 1..3) {
    try {
      # Windows DNS on this PC can't resolve the AliExpress CDN, so use curl.exe with
      # DNS-over-HTTPS (Cloudflare / Google) and rotate through the CDN host names.
      $hosts = @('ae-pic-a1.aliexpress-media.com', 'ae01.alicdn.com', 'ae04.alicdn.com')
      $doh = @('https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query', 'https://1.0.0.1/dns-query')
      $h = $hosts[($attempt - 1) % $hosts.Count]
      $src = $u -replace '^https://[^/]+/', "https://$h/"
      $curlOut = & curl.exe -sS -L --fail --max-time 60 --doh-url $doh[($attempt - 1) % $doh.Count] -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' -e 'https://www.aliexpress.us/' -o "$dest" "$src" 2>&1
      if ($LASTEXITCODE -ne 0) { throw "curl $LASTEXITCODE $curlOut" }
      if ((Get-Item $dest).Length -gt 1000) { $done = $true; break }
    } catch { "ERR $u : $($_.Exception.Message)" | Out-File $log -Append; Start-Sleep -Seconds 2 }
  }
  if ($done) { $ok++; "OK $name" | Out-File $log -Append } else { $fail++; Write-Host "FAILED: $u" -ForegroundColor Red; Remove-Item $dest -ErrorAction SilentlyContinue }
}
"DONE ok=$ok skip=$skip fail=$fail" | Out-File $log -Append
Write-Host ""
Write-Host "Downloaded $ok new, $skip already there, $fail failed. Photos are in: $out" -ForegroundColor Green
