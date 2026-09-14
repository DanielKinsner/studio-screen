import type { Project } from './types';
const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open('studio-screen', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' });
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', mode); const request = run(tx.objectStore('projects'));
    tx.oncomplete = () => { resolve(request.result); db.close(); };
    tx.onerror = () => { reject(tx.error); db.close(); }; tx.onabort = () => { reject(tx.error); db.close(); };
  });
}
export const saveProject = (p: Project) => operation('readwrite', s => s.put({ ...p, updated: Date.now() }));
export const listProjects = () => operation<Project[]>('readonly', s => s.getAll());
export const deleteProject = (id: string) => operation('readwrite', s => s.delete(id));
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function projectFile(p: Project) {
  const encoded: Record<string, unknown> = { ...p, format: 'studio-screen', version: 1 };
  for (const key of ['video', 'camera', 'music', 'backgroundImage'] as const) {
    if (p[key]) encoded[key] = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(new Blob([p[key]!], { type: p[key]!.type.split(';')[0] })); });
  }
  return new Blob([JSON.stringify(encoded)], { type: 'application/json' });
}
export async function readProject(file: File): Promise<Project> {
  const p = JSON.parse(await file.text());
  if (p.format !== 'studio-screen' || p.version !== 1 || !p.settings || !Number.isFinite(p.duration) || p.duration <= 0 || !Array.isArray(p.cuts) || !Array.isArray(p.zooms) || !Array.isArray(p.captions) || !Array.isArray(p.annotations) || !Array.isArray(p.points)) throw new Error('This is not a supported Studio Screen project.');
  if (!(p.settings.speed > 0 && p.settings.speed <= 4) || p.trimStart < 0 || p.trimEnd > p.duration || p.trimEnd <= p.trimStart) throw new Error('The project contains invalid timing.');
  for (const key of ['video', 'camera', 'music', 'backgroundImage']) {
    if (p[key]) { if (typeof p[key] !== 'string' || !p[key].startsWith('data:')) throw new Error('Invalid embedded media.'); p[key] = await (await fetch(p[key])).blob(); }
  }
  p.id = crypto.randomUUID(); return p;
}
