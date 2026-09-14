import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 256, height: 256 },
  deviceScaleFactor: 1,
});
await page.setContent(
  `<html><body style="margin:0;background:transparent">${await fs.readFile("public/logo.svg", "utf8")}</body></html>`,
);
await fs.mkdir("build", { recursive: true });
const png = await page.screenshot({
  omitBackground: true,
  path: "build/icon.png",
});
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await fs.writeFile("build/icon.ico", Buffer.concat([header, png]));
await browser.close();
