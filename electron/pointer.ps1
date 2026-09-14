param([long]$WindowHandle = 0)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class StudioPointer {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out Rect rect, int size);
  public static bool Down(int key) { return (GetAsyncKeyState(key)&0x8000)!=0; }
  public static void Run(long handle) {
    SetProcessDPIAware(); bool wasDown = false; bool[] previous = new bool[124];
    while (true) {
      Point point; GetCursorPos(out point);
      bool down = (GetAsyncKeyState(1) & 0x8000) != 0;
      bool active=handle==0||GetForegroundWindow()==new IntPtr(handle);
      bool ctrl=Down(17),alt=Down(18),shift=Down(16),win=Down(91)||Down(92),typing=false;
      string shortcut="";
      for(int key=32;key<=123;key++) {
        bool pressed=Down(key);
        if(pressed&&!previous[key]&&active) {
          bool letter=(key>=48&&key<=90),function=key>=112;
          if((ctrl||alt||win||function)&&(letter||function||key==32)) {
            string label=function?"F"+(key-111):key==32?"Space":((char)key).ToString();
            shortcut=(ctrl?"Ctrl + ":"")+(alt?"Alt + ":"")+(win?"Win + ":"")+(shift?"Shift + ":"")+label;
          } else if(!ctrl&&!alt&&!win&&(letter||key==32)) typing=true;
        }
        previous[key]=pressed;
      }
      Rect r=new Rect(); bool valid=handle==0||DwmGetWindowAttribute(new IntPtr(handle),9,out r,16)==0;
      if(valid)Console.WriteLine("["+point.X+","+point.Y+","+((down&&!wasDown&&active)?"true":"false")+",\""+shortcut+"\","+(typing?"true":"false")+","+r.Left+","+r.Top+","+(r.Right-r.Left)+","+(r.Bottom-r.Top)+"]");
      Console.Out.Flush(); wasDown = down; Thread.Sleep(16);
    }
  }
}
'@
[StudioPointer]::Run($WindowHandle)
