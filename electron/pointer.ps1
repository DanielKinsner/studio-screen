$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class StudioPointer {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static void Run() {
    SetProcessDPIAware(); bool wasDown = false;
    while (true) {
      Point point; GetCursorPos(out point);
      bool down = (GetAsyncKeyState(1) & 0x8000) != 0;
      Console.WriteLine("[" + point.X + "," + point.Y + "," + ((down && !wasDown) ? "true" : "false") + "]");
      Console.Out.Flush(); wasDown = down; Thread.Sleep(16);
    }
  }
}
'@
[StudioPointer]::Run()
