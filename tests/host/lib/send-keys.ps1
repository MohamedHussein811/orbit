# Posts key and mouse messages directly to one browser window. Nothing goes through global input,
# so keys cannot reach any other application.
param(
  [Parameter(Mandatory = $true)][string]$ProcessIds,
  [Parameter(Mandatory = $true)][string]$Keys,
  [string]$TitleLike = "",
  [switch]$Smallest
)
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class KeyPost {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool GetKeyboardState(byte[] s);
  [DllImport("user32.dll")] public static extern bool SetKeyboardState(byte[] s);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint c, uint t);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  const uint WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_CHAR = 0x102;

  public static IntPtr Find(HashSet<uint> pids, string titleLike) {
    IntPtr best = IntPtr.Zero; long bestArea = 0;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (!pids.Contains(p) || !IsWindowVisible(h)) return true;
      var s = new StringBuilder(512); GetWindowText(h, s, 512);
      if (titleLike.Length > 0 && s.ToString().IndexOf(titleLike, StringComparison.OrdinalIgnoreCase) < 0) return true;
      RECT r; GetWindowRect(h, out r);
      long area = (long)(r.R - r.L) * (r.B - r.T);
      if (area > bestArea) { bestArea = area; best = h; }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  public static IntPtr FindSmallest(HashSet<uint> pids, long minArea) {
    IntPtr best = IntPtr.Zero; long bestArea = long.MaxValue;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (!pids.Contains(p) || !IsWindowVisible(h)) return true;
      RECT r; GetWindowRect(h, out r);
      long area = (long)(r.R - r.L) * (r.B - r.T);
      if (area >= minArea && area < bestArea) { bestArea = area; best = h; }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  public static void Click(IntPtr h, int x, int y) {
    IntPtr at = (IntPtr)((y << 16) | (x & 0xFFFF));
    PostMessage(h, 0x200, IntPtr.Zero, at);
    Thread.Sleep(150);
    PostMessage(h, 0x201, (IntPtr)1, at);
    Thread.Sleep(80);
    PostMessage(h, 0x202, IntPtr.Zero, at);
  }

  public static void RightClick(IntPtr h, int x, int y) {
    IntPtr at = (IntPtr)((y << 16) | (x & 0xFFFF));
    PostMessage(h, 0x200, IntPtr.Zero, at);
    Thread.Sleep(150);
    PostMessage(h, 0x204, (IntPtr)2, at);
    Thread.Sleep(80);
    PostMessage(h, 0x205, IntPtr.Zero, at);
  }

  public static void Hover(IntPtr h, int x, int y) {
    PostMessage(h, 0x200, IntPtr.Zero, (IntPtr)((y << 16) | (x & 0xFFFF)));
  }

  public static bool Focus(IntPtr h) {
    uint pid; uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fg, true);
    bool ok = SetForegroundWindow(h);
    AttachThreadInput(me, fg, false);
    return ok;
  }

  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }

  public static void Chord(IntPtr h, bool ctrl, bool shift, uint vk) {
    uint pid; uint target = GetWindowThreadProcessId(h, out pid);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, target, true);
    byte[] saved = new byte[256]; GetKeyboardState(saved);
    byte[] state = (byte[])saved.Clone();
    if (ctrl) { state[0x11] = 0x80; state[0xA2] = 0x80; }
    if (shift) { state[0x10] = 0x80; state[0xA0] = 0x80; }
    SetKeyboardState(state);
    uint scan = MapVirtualKey(vk, 0);
    PostMessage(h, WM_KEYDOWN, (IntPtr)vk, (IntPtr)(1 | (scan << 16)));
    Thread.Sleep(160);
    PostMessage(h, WM_KEYUP, (IntPtr)vk, (IntPtr)unchecked((int)(1 | (scan << 16) | 0xC0000000u)));
    Thread.Sleep(120);
    SetKeyboardState(saved);
    AttachThreadInput(me, target, false);
  }

  public static void Text(IntPtr h, string text) {
    foreach (char c in text) {
      PostMessage(h, WM_CHAR, (IntPtr)c, (IntPtr)1);
      Thread.Sleep(25);
    }
  }
}
"@
$set = New-Object 'System.Collections.Generic.HashSet[uint32]'
foreach ($p in $ProcessIds.Split(",")) { [void]$set.Add([uint32]$p) }
$hwnd = if ($Smallest) { [KeyPost]::FindSmallest($set, 20000) } else { [KeyPost]::Find($set, $TitleLike) }
if ($hwnd -eq [IntPtr]::Zero) { "no window"; exit 0 }
if ($Keys.StartsWith("click:")) {
  $xy = $Keys.Substring(6).Split(",")
  [KeyPost]::Click($hwnd, [int]$xy[0], [int]$xy[1])
  "clicked $($Keys.Substring(6)) in '$([KeyPost]::Title($hwnd))'"
  exit 0
}
if ($Keys -eq "focus") {
  "focus=$([KeyPost]::Focus($hwnd)) on '$([KeyPost]::Title($hwnd))'"
  exit 0
}
if ($Keys -eq "close") {
  [void][KeyPost]::PostMessage($hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
  "closed '$([KeyPost]::Title($hwnd))'"
  exit 0
}
if ($Keys -eq "hide") {
  [void][KeyPost]::ShowWindowAsync($hwnd, 0)
  "hid '$([KeyPost]::Title($hwnd))'"
  exit 0
}
if ($Keys.StartsWith("hover:")) {
  $xy = $Keys.Substring(6).Split(",")
  [KeyPost]::Hover($hwnd, [int]$xy[0], [int]$xy[1])
  "hover $($Keys.Substring(6)) in '$([KeyPost]::Title($hwnd))'"
  exit 0
}
if ($Keys.StartsWith("rclick:")) {
  $xy = $Keys.Substring(7).Split(",")
  [KeyPost]::RightClick($hwnd, [int]$xy[0], [int]$xy[1])
  "right-clicked $($Keys.Substring(7)) in '$([KeyPost]::Title($hwnd))'"
  exit 0
}
if ($Keys.StartsWith("text:")) {
  [KeyPost]::Text($hwnd, $Keys.Substring(5))
  "typed into '$([KeyPost]::Title($hwnd))'"
  exit 0
}
$named = @{ f11 = 0x7A; enter = 0x0D; esc = 0x1B; plus = 0xBB; minus = 0xBD; tab = 0x09 }
$parts = $Keys.ToLower().Split("+")
$key = $parts[-1]
$vk = if ($named.ContainsKey($key)) { $named[$key] } else { [int][char]$key.ToUpper() }
[KeyPost]::Chord($hwnd, ($parts -contains "ctrl"), ($parts -contains "shift"), [uint32]$vk)
"sent $Keys to '$([KeyPost]::Title($hwnd))' foreground=$([KeyPost]::GetForegroundWindow() -eq $hwnd)"
exit 0
