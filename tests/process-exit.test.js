import { expect, test } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { waitForExit } from "./process-exit.mjs";

test("observes a helper that exits while being awaited", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(7)"], { windowsHide: true });
  expect(await waitForExit(child)).toEqual({ code: 7, signal: null });
});

test("cannot hang when the helper already exited before the stop request", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(9)"], { windowsHide: true });
  await once(child, "close");
  expect(await waitForExit(child)).toEqual({ code: 9, signal: null });
}, 1000);
