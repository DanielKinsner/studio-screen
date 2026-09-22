import { expect, test } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
const { openHelperPipe } = createRequire(import.meta.url)(
  "../electron/helper-pipe.cjs",
);

// The helper can die mid-take (driver reset, a monitor unplugged) a moment
// before the app hears about it. A pause/stop sent in that moment writes into
// a closed pipe; that must never become an uncaught error in the main process.
test("a command sent to a helper that just died does not crash the app", async () => {
  const crashes = [];
  const onCrash = (e) => crashes.push(e.code || e.message);
  process.prependListener("uncaughtException", onCrash);
  try {
    for (let i = 0; i < 5; i++) {
      // The helper dies on its own mid-take while commands keep arriving.
      const child = spawn(
        process.execPath,
        ["-e", "process.stdin.resume(); setTimeout(() => process.exit(1), 150)"],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      const command = openHelperPipe(child);
      let exited = false;
      child.on("exit", () => (exited = true));
      while (!exited) {
        command("pause");
        await new Promise((r) => setImmediate(r));
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    process.off("uncaughtException", onCrash);
  }
  expect(crashes).toEqual([]);
});

test("commands still reach a live helper", async () => {
  const child = spawn(
    process.execPath,
    ["-e", "process.stdin.once('data', d => { process.stdout.write(d); process.exit(0) })"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const command = openHelperPipe(child);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  expect(command("pause")).toBe(true);
  await once(child, "exit");
  expect(out).toBe("pause\n");
});
