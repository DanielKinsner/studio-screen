// One-command capability check for a PC: builds nothing, just asks the capture
// helper what this machine supports. Run `npm run native:build` first.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const exe = "native/studio-capture/target/release/studio-capture.exe";
if (!existsSync(exe)) {
  console.log("The capture helper isn't built yet. Run: npm run native:build");
  process.exit(1);
}
const report = JSON.parse(execFileSync(exe, ["check"], { encoding: "utf8" }));
const row = (ok, label, detail = "") =>
  console.log(`${ok ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
row(report.captureSupported, "Windows screen capture");
row(
  report.borderlessAccess === 4,
  "Recording without the yellow border",
  report.borderlessAccess === 4
    ? ""
    : "turn on Settings › Privacy › Screenshot borders for desktop apps",
);
row(
  report.dirtyRegions,
  "Screen-change tracking (idle detection)",
  report.dirtyRegions ? "" : "needs Windows 11 24H2",
);
row(report.hardwareH264, "Hardware H.264 encoder", report.adapter);
row(report.loopbackAudio, "System audio capture");
