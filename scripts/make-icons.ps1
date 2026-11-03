# Generate the Kodra icon set (PNG + multi-size ICO) with System.Drawing.
#
# The mark is a sharp gold "K" on a near-black rounded square, matching the
# app palette (--surface-0 #0a0a0a, --accent #d4a73c). Everything is drawn from
# primitives so the output is reproducible on any Windows machine:
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
#
# Output: src-tauri/icons/*.png, src-tauri/icons/icon.ico and app/public/icon.png.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$iconsDir = Join-Path $root 'src-tauri\icons'
$publicDir = Join-Path $root 'app\public'
New-Item -ItemType Directory -Force -Path $iconsDir, $publicDir | Out-Null

$bg = [System.Drawing.Color]::FromArgb(255, 0x0d, 0x0d, 0x0d)
$gold = [System.Drawing.Color]::FromArgb(255, 0xd4, 0xa7, 0x3c)
$sheen = [System.Drawing.Color]::FromArgb(255, 0xff, 0xc8, 0x57)
$outline = [System.Drawing.Color]::FromArgb(38, 255, 255, 255)

function New-RoundedPath([single]$size, [single]$inset) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = [single]($size * 0.22)
    $x = $inset
    $y = $inset
    $w = [single]($size - ($inset * 2))
    $h = [single]($size - ($inset * 2))
    $d = [single]($r * 2)
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc([single]($x + $w - $d), $y, $d, $d, 270, 90)
    $path.AddArc([single]($x + $w - $d), [single]($y + $h - $d), $d, $d, 0, 90)
    $path.AddArc($x, [single]($y + $h - $d), $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

# Render at 8x and downsample so small sizes keep clean edges.
function New-IconBitmap([int]$size) {
    $scale = 8
    $big = [System.Drawing.Bitmap]::new([int]($size * $scale), [int]($size * $scale))
    $g = [System.Drawing.Graphics]::FromImage($big)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $S = [single]($size * $scale)

    $plate = New-RoundedPath $S 0
    $bgBrush = [System.Drawing.SolidBrush]::new($bg)
    $g.FillPath($bgBrush, $plate)
    if ($size -ge 32) {
        $pen = [System.Drawing.Pen]::new($outline, [single]($S * 0.006))
        $g.DrawPath($pen, $plate)
        $pen.Dispose()
    }

    # Vertical stem.
    $stem = [System.Drawing.RectangleF]::new(
        [single]($S * 0.300), [single]($S * 0.255),
        [single]($S * 0.096), [single]($S * 0.490))
    $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $stem, $gold, $sheen,
        [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillRectangle($brush, $stem)
    $brush.Dispose()

    # Upper and lower arms. Both start inside the stem so the junction is solid
    # at every size.
    $armPen = [System.Drawing.Pen]::new($gold, [single]($S * 0.092))
    $armPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $armPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Flat
    $armPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
    $joint = [System.Drawing.PointF]::new([single]($S * 0.352), [single]($S * 0.500))
    $g.DrawLine($armPen, $joint,
        [System.Drawing.PointF]::new([single]($S * 0.690), [single]($S * 0.272)))
    $g.DrawLine($armPen, $joint,
        [System.Drawing.PointF]::new([single]($S * 0.690), [single]($S * 0.728)))
    $armPen.Dispose()

    $g.Dispose()
    $plate.Dispose()
    $bgBrush.Dispose()

    $out = [System.Drawing.Bitmap]::new($size, $size)
    $og = [System.Drawing.Graphics]::FromImage($out)
    $og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $og.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $og.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $og.DrawImage($big, ([System.Drawing.Rectangle]::new(0, 0, $size, $size)))
    $og.Dispose()
    $big.Dispose()
    return $out
}

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

$sizes = @{ '32x32.png' = 32; '128x128.png' = 128; '128x128@2x.png' = 256; 'icon.png' = 512 }
foreach ($name in $sizes.Keys) {
    $bmp = New-IconBitmap $sizes[$name]
    Save-Png $bmp (Join-Path $iconsDir $name)
    if ($name -eq 'icon.png') { Save-Png $bmp (Join-Path $publicDir 'icon.png') }
    $bmp.Dispose()
}

# Multi-size ICO with uncompressed 32-bit BGRA entries, which every Windows
# version (and tauri-winres) reads without surprises.
$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$entries = @()
foreach ($s in $icoSizes) {
    $bmp = New-IconBitmap $s
    $rect = [System.Drawing.Rectangle]::new(0, 0, $s, $s)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $raw = New-Object byte[] ($stride * $s)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
    $bmp.UnlockBits($data)

    $xor = New-Object byte[] ($s * $s * 4)
    for ($y = 0; $y -lt $s; $y++) {
        $src = ($s - 1 - $y) * $stride
        $dst = $y * $s * 4
        for ($x = 0; $x -lt $s; $x++) {
            $o = $src + ($x * 4)
            $d = $dst + ($x * 4)
            $xor[$d] = $raw[$o + 0]      # B
            $xor[$d + 1] = $raw[$o + 1]  # G
            $xor[$d + 2] = $raw[$o + 2]  # R
            $xor[$d + 3] = $raw[$o + 3]  # A
        }
    }

    $maskStride = [int]([Math]::Ceiling($s / 32.0) * 4)
    $mask = New-Object byte[] ($maskStride * $s)

    $stream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($stream)
    $writer.Write([uint32]40)
    $writer.Write([int32]$s)
    $writer.Write([int32]($s * 2))
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]0)
    $writer.Write([uint32]($xor.Length + $mask.Length))
    $writer.Write([int32]0)
    $writer.Write([int32]0)
    $writer.Write([uint32]0)
    $writer.Write([uint32]0)
    $writer.Write($xor)
    $writer.Write($mask)
    $writer.Flush()
    $entries += ,@($s, $stream.ToArray())
    $writer.Dispose()
    $stream.Dispose()
    $bmp.Dispose()
}

$icoPath = Join-Path $iconsDir 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$entries.Count)
$offset = 6 + (16 * $entries.Count)
foreach ($entry in $entries) {
    $s = $entry[0]
    $bytes = $entry[1]
    $dim = if ($s -ge 256) { 0 } else { $s }
    $bw.Write([byte]$dim)
    $bw.Write([byte]$dim)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$bytes.Length)
    $bw.Write([uint32]$offset)
    $offset += $bytes.Length
}
foreach ($entry in $entries) { $bw.Write($entry[1]) }
$bw.Flush()
$bw.Dispose()
$fs.Dispose()

Get-ChildItem $iconsDir -File | Select-Object Name, Length | Format-Table -AutoSize
