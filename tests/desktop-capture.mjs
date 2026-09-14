import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const regionMode = process.argv.includes('--region');
const prefix = regionMode ? 'region' : 'native';
const application = await electron.launch({ args: ['.', '--dev'], cwd: root, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });
try {
  const page = await application.firstWindow();
  await page.getByText('Saved locally', { exact: true }).waitFor();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await application.evaluate(async ({ BrowserWindow }) => {
    const fixture = new BrowserWindow({ width: 850, height: 600, title: 'Studio Screen Capture Test', webPreferences: { backgroundThrottling: false } });
    await fixture.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><title>Studio Screen Capture Test</title><body style="background:#dba482;color:#18372c;font:40px sans-serif;padding:50px"><h1>Studio Screen capture test</h1><p>Real system audio · 440 Hz</p><button id="tone" style="font-size:24px">Play test tone</button><div id="clock"></div><script>setInterval(()=>clock.textContent=new Date().toISOString(),50);tone.onclick=async()=>{const c=new AudioContext();await c.resume();const o=c.createOscillator();const g=c.createGain();g.gain.value=.08;o.frequency.value=440;o.connect(g).connect(c.destination);o.start();window.testAudio=c;};</script></body>'));
  });
  const fixture = application.windows().find(p => p !== page);
  await fixture.waitForLoadState(); await fixture.getByRole('button', { name: 'Play test tone' }).click();
  await page.getByRole('button', { name: 'New recording', exact: true }).click();
  await page.evaluate(() => window.studioDesktop.sources());
  await page.getByRole('button', { name: 'Studio Screen Capture Test', exact: true }).click();
  if (regionMode) { await page.getByLabel('Capture area', { exact: true }).selectOption('region'); await page.getByLabel('Capture area width', { exact: true }).fill('50'); await page.getByLabel('Capture area height', { exact: true }).fill('50'); }
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.getByRole('button', { name: 'Finish recording', exact: true }).waitFor({ timeout: 30000 });
  await new Promise(r => setTimeout(r, 2300));
  await page.getByRole('button', { name: 'Pause recording', exact: true }).click();
  await new Promise(r => setTimeout(r, 500));
  await page.getByRole('button', { name: 'Resume recording', exact: true }).click();
  await new Promise(r => setTimeout(r, 1300));
  await page.getByRole('button', { name: 'Finish recording', exact: true }).click();
  await page.getByText('Recording ready. Make it your own.', { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText('Saved locally', { exact: true }).waitFor();
  const result = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('studio-screen', 1); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const projects = await new Promise((res, rej) => { const r = db.transaction('projects').objectStore('projects').getAll(); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const p = projects.sort((a, b) => b.updated - a.updated)[0];
    const data = await new Promise(res => { const reader = new FileReader(); reader.onload = () => res(reader.result); reader.readAsDataURL(p.video); });
    return { duration: p.duration, videoBytes: p.video.size, data, points: p.points.length };
  });
  await fs.writeFile(path.join(root, `tests/${prefix}-capture.webm`), Buffer.from(result.data.split(';base64,')[1], 'base64')); delete result.data;
  await page.screenshot({ path: path.join(root, `tests/${prefix}-capture.png`) });
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  await page.getByLabel('Export resolution').selectOption('720');
  await application.evaluate(({ session }, filename) => { session.defaultSession.once('will-download', (_event, item) => item.setSavePath(filename)); }, path.join(root, `tests/${prefix}-export.webm`));
  await page.getByRole('dialog').getByRole('button', { name: 'Export video', exact: true }).click();
  await page.getByText('That’s a wrap.', { exact: true }).waitFor({ timeout: 25000 }).catch(async e => { console.log(await page.locator('body').innerText()); throw e; });
  await new Promise(r => setTimeout(r, 1200));
  await fs.writeFile(path.join(root, `tests/${prefix}-results.json`), JSON.stringify({ ...result, errors, exported: true }, null, 2));
  expect(result.duration).toBeGreaterThan(3); expect(result.videoBytes).toBeGreaterThan(1000); expect(errors).toEqual([]);
  console.log('PASS: real desktop window capture, Windows system audio requested, pause/resume, editor import, rendered export.');
} finally { await application.close(); }
