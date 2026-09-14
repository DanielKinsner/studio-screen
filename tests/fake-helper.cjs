// Stand-in for studio-capture.exe used by tests that must not record the
// screen. Speaks the same stdio protocol and, on "stop", delivers a prepared
// take (STUDIO_FAKE_TAKE folder with recording.mp4 + events.jsonl).
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const config = JSON.parse(process.argv[3]);
const take = process.env.STUDIO_FAKE_TAKE;
const seconds = Number(process.env.STUDIO_FAKE_SECONDS || 300);
const emit = (message) => process.stdout.write(JSON.stringify(message) + "\n");

emit({ event: "ready", width: 1920, height: 1080 });
let started = 0;
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const command = line.trim();
  if (command === "begin") {
    started = Date.now();
    emit({ event: "started", width: 1920, height: 1080, fps: 60, audio: true });
  } else if (command === "stop") {
    fs.copyFileSync(path.join(take, "recording.mp4"), config.output);
    fs.copyFileSync(path.join(take, "events.jsonl"), config.events);
    emit({
      event: "stopped",
      reason: "stopped",
      seconds,
      frames: seconds * 60,
    });
    process.exit(0);
  }
});
lines.on("close", () => process.exit(0));
setInterval(() => {
  if (started)
    emit({
      event: "stats",
      seconds: (Date.now() - started) / 1000,
      frames: 0,
      captured: 0,
      paused: false,
    });
}, 1000);
