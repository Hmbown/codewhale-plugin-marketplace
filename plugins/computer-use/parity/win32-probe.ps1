# Standalone host-state probe for the win32 parity driver.
# Shares no code with the backend under test: it reads the console session's
# pointer position and foreground window directly (GetCursorPos +
# GetForegroundWindow), the way parity/darwin-probe.m does on macOS. The
# engine compares consecutive samples to report pointer displacement and
# foreground-window theft per task.
# Prints one JSON object on stdout.

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CUProbe {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public struct POINT { public int X; public int Y; }
}
"@

$p = New-Object CUProbe+POINT
[void][CUProbe]::GetCursorPos([ref]$p)
$fg = [CUProbe]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][CUProbe]::GetWindowText($fg, $sb, $sb.Capacity)
$fpid = 0
[void][CUProbe]::GetWindowThreadProcessId($fg, [ref]$fpid)

Add-Type -AssemblyName System.Windows.Forms
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen

@{
  pointer = @{ x = $p.X; y = $p.Y }
  activeWindow = $sb.ToString()
  foregroundPid = [int]$fpid
  display = @{ x = $vs.X; y = $vs.Y; w = $vs.Width; h = $vs.Height }
} | ConvertTo-Json -Compress
