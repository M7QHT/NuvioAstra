<#
  Dumps the window tree of a process's main window: class, handle, parent, client-relative
  rectangle, size, styles, visibility, enabled state, owning thread. Diagnostic for the embedded
  player (container / mpv video window / WebView2 windows).

  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File inspect-windows.ps1 -ProcessName nuvio-desktop
#>
param([Parameter(Mandatory = $true)][string]$ProcessName)

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class WinTree {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    public static List<string> Dump(IntPtr root) {
        var lines = new List<string>();
        POINT origin = new POINT(); ClientToScreen(root, ref origin);
        RECT rc; GetClientRect(root, out rc);
        lines.Add(string.Format("ROOT 0x{0:X} client {1}x{2} at screen ({3},{4})", root.ToInt64(), rc.R, rc.B, origin.X, origin.Y));
        int order = 0;
        EnumChildWindows(root, (h, l) => {
            var cls = new StringBuilder(128); GetClassName(h, cls, 128);
            RECT r; GetWindowRect(h, out r);
            uint pid; uint tid = GetWindowThreadProcessId(h, out pid);
            int style = GetWindowLong(h, -16), ex = GetWindowLong(h, -20);
            // depth = number of ancestors up to root
            int depth = 0; IntPtr p = GetParent(h); while (p != IntPtr.Zero && p != root) { depth++; p = GetParent(p); }
            lines.Add(string.Format("{0}{1,2}. {2,-40} 0x{3:X} parent 0x{4:X} rel=({5},{6}) size={7}x{8} vis={9} en={10} style=0x{11:X8} ex=0x{12:X8} tid={13} pid={14}",
                new string(' ', depth * 2), order++, cls, h.ToInt64(), GetParent(h).ToInt64(), r.L - origin.X, r.T - origin.Y, r.R - r.L, r.B - r.T,
                IsWindowVisible(h) ? 1 : 0, IsWindowEnabled(h) ? 1 : 0, style, ex, tid, pid));
            return true;
        }, IntPtr.Zero);
        return lines;
    }
}
"@

$p = Get-Process -Name $ProcessName -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
if (-not $p) { throw "no window for $ProcessName" }
[WinTree]::Dump($p.MainWindowHandle) | ForEach-Object { $_ }
