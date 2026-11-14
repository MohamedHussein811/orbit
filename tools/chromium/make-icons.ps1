# Renders Orbit's logos into the files Chromium's unbranded theme uses, under chromium/overlay.
#   powershell -File tools/chromium/make-icons.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path "$PSScriptRoot\..\.."
$icons = "$root\branding\icons"
$out = "$root\chromium\overlay"
$macIcons = "$root\chromium\mac-icons"
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$work = Join-Path ([IO.Path]::GetTempPath()) "orbit-icons-$PID"
New-Item -ItemType Directory -Force $work, $macIcons | Out-Null

$mark = (Get-Content "$root\branding\orbit-mark.svg" -Raw) -replace '<svg ', '<svg width="100%" height="100%" '
$mono = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 96 320 320" width="100%" height="100%"><path d="M385.43 221.32 A134 134 0 1 1 290.68 126.57" fill="none" stroke="#0c0c0c" stroke-width="46" stroke-linecap="round"/><circle cx="350.75" cy="161.25" r="30" fill="#0c0c0c"/></svg>'

function Render($svg, $canvas, $size, $file) {
  $offset = [math]::Floor(($canvas - $size) / 2)
  $html = "<!doctype html><html><body style='margin:0;background:transparent'><div style='position:absolute;left:${offset}px;top:${offset}px;width:${size}px;height:${size}px'>$svg</div></body></html>"
  $page = Join-Path $work "page.html"
  Set-Content -Path $page -Value $html -Encoding utf8
  $profile = Join-Path $work "profile"
  $ErrorActionPreference = "Continue"
  & $edge --headless --disable-gpu --no-first-run --user-data-dir="$profile" --force-device-scale-factor=1 --hide-scrollbars --default-background-color=00000000 --window-size="$canvas,$canvas" --screenshot="$file" "file:///$($page -replace '\\','/')" 2>$null | Out-Null
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-Path $file)) {
    if ((Get-Date) -gt $deadline) { throw "Edge did not render $file" }
    Start-Sleep -Milliseconds 200
  }
}

function Place($from, $to) {
  $target = Join-Path $out $to
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  Copy-Item $from $target -Force
}

function Resize($from, $width, $height, $to) {
  $source = [Drawing.Image]::FromFile($from)
  $bitmap = New-Object Drawing.Bitmap ([int]$width), ([int]$height)
  $g = [Drawing.Graphics]::FromImage($bitmap)
  $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($source, 0, 0, $width, $height)
  $target = Join-Path $out $to
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  $bitmap.Save($target, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bitmap.Dispose(); $source.Dispose()
}

function Xpm($from, $to) {
  $bitmap = [Drawing.Bitmap]::FromFile($from)
  $alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+@"
  $codes = [ordered]@{}
  $rows = @()
  for ($y = 0; $y -lt $bitmap.Height; $y++) {
    $row = ""
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
      $p = $bitmap.GetPixel($x, $y)
      if ($p.A -lt 128) { $row += "  "; continue }
      $color = "#{0:X2}{1:X2}{2:X2}" -f $p.R, $p.G, $p.B
      if (-not $codes.Contains($color)) {
        $n = $codes.Count
        $codes[$color] = "" + $alphabet[[math]::Floor($n / 64)] + $alphabet[$n % 64]
      }
      $row += $codes[$color]
    }
    $rows += $row
  }
  $lines = @("/* XPM */", "static char * linux_icon_chromium_32_xpm[] = {", "`"$($bitmap.Width) $($bitmap.Height) $($codes.Count + 1) 2`",", "`"  `tc None`",")
  foreach ($color in $codes.Keys) { $lines += "`"$($codes[$color])`tc $color`"," }
  $lines += ($rows | ForEach-Object { "`"$_`"" }) -join ",`n"
  $lines += "};"
  $bitmap.Dispose()
  $target = Join-Path $out $to
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  [IO.File]::WriteAllText($target, ($lines -join "`n") + "`n")
}

Render $mark 24 24 "$work\mark-24.png"
Render $mark 1024 1024 "$work\mark-1024.png"
Render $mark 600 220 "$work\tile-600.png"
Render $mark 176 118 "$work\tile-176.png"
Render $mono 22 16 "$work\mono-22.png"

$theme = "chrome\app\theme"
foreach ($size in 16, 24, 48, 64, 128, 256) {
  $from = if ($size -eq 24) { "$work\mark-24.png" } else { "$icons\orbit-$size.png" }
  Place $from "$theme\chromium\product_logo_$size.png"
  if ($size -ne 16) { Place $from "$theme\chromium\linux\product_logo_$size.png" }
}
Place "$work\mono-22.png" "$theme\chromium\product_logo_22_mono.png"
Place "$root\branding\orbit-mark.svg" "$theme\chromium\product_logo.svg"
Xpm "$icons\orbit-32.png" "$theme\chromium\linux\product_logo_32.xpm"

foreach ($scale in "100", "200") {
  $factor = [int]$scale / 100
  foreach ($size in 16, 32) {
    Place "$icons\orbit-$($size * $factor).png" "$theme\default_${scale}_percent\chromium\product_logo_$size.png"
  }
  $logo = if ($factor -eq 1) { "171x32" } else { "342x64" }
  $height = 22 * $factor
  $width = [math]::Round(171 * $height / 32)
  Resize "$icons\logo-$logo.png" $width $height "$theme\default_${scale}_percent\chromium\product_logo_name_22.png"
  Resize "$icons\logo-white-$logo.png" $width $height "$theme\default_${scale}_percent\chromium\product_logo_name_22_white.png"
}
foreach ($size in 16, 32) {
  Place "$icons\orbit-$size.png" "$theme\default_100_percent\chromium\linux\product_logo_$size.png"
}

foreach ($name in "chromium", "app_list", "chromium_doc", "chromium_pdf") {
  Place "$icons\orbit.ico" "$theme\chromium\win\$name.ico"
}
Place "$work\tile-600.png" "$theme\chromium\win\tiles\Logo.png"
Place "$work\tile-176.png" "$theme\chromium\win\tiles\SmallLogo.png"
Place "$icons\orbit.icns" "$theme\chromium\mac\app.icns"

foreach ($size in 16, 32, 64, 128, 256, 512) {
  Copy-Item "$icons\orbit-$size.png" "$macIcons\icon_$size.png" -Force
}
Copy-Item "$work\mark-1024.png" "$macIcons\icon_1024.png" -Force

Remove-Item -Recurse -Force $work
Get-ChildItem -Recurse $out, $macIcons -File | ForEach-Object { $_.FullName.Substring($root.Path.Length + 1) }
