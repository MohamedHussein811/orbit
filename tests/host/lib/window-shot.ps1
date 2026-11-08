# Captures only the windows belonging to the given process ids, never the whole screen.
param(
  [Parameter(Mandatory = $true)][string]$ProcessIds,
  [Parameter(Mandatory = $true)][string]$OutPrefix
)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class WinCap {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<IntPtr> Find(HashSet<uint> pids) {
    var found = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (pids.Contains(p) && IsWindowVisible(h)) found.Add(h); return true; }, IntPtr.Zero);
    return found;
  }
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
}
"@
[void][WinCap]::SetProcessDPIAware()
$set = New-Object 'System.Collections.Generic.HashSet[uint32]'
foreach ($p in $ProcessIds.Split(",")) { [void]$set.Add([uint32]$p) }
$i = 0
foreach ($h in [WinCap]::Find($set)) {
  try {
    $r = New-Object WinCap+RECT
    [void][WinCap]::GetWindowRect($h, [ref]$r)
    $w = $r.R - $r.L; $ht = $r.B - $r.T
    if ($w -lt 200 -or $ht -lt 100) { continue }
    $bmp = New-Object System.Drawing.Bitmap $w, $ht
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $dc = $g.GetHdc()
    [void][WinCap]::PrintWindow($h, $dc, 2)
    $g.ReleaseHdc($dc)
    $path = "$OutPrefix-$i.png"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    "$path  ${w}x$ht  '$([WinCap]::Title($h))'"
    $g.Dispose(); $bmp.Dispose(); $i++
  } catch {
    "skipped a window: $($_.Exception.Message)"
  }
}
if ($i -eq 0) { "no visible window for those processes" }
exit 0
