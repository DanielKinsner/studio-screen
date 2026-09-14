# Prints seconds since the last real keyboard or mouse input on this PC.
# Tests that inject input or record the screen check this first so they never
# fight with someone using the computer.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StudioIdle {
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  public static double Seconds() {
    var info = new LASTINPUTINFO(); info.cbSize = (uint)Marshal.SizeOf(info);
    GetLastInputInfo(ref info);
    return (Environment.TickCount - (int)info.dwTime) / 1000.0;
  }
}
'@
[StudioIdle]::Seconds()
