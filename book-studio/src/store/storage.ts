// 프로젝트·사용자 폰트를 기기 안(IndexedDB)에 저장한다. 네트워크 없이 동작한다.
import type { Project } from '../model/types';

export interface ProjectSummary {
  id: string;
  title: string;
  author: string;
  updatedAt: number;
  width: number;
  height: number;
  presetId: string;
  pageCount: number;
}

export interface StoredFont {
  key: string;
  family: string;
  bold: boolean;
  data: Uint8Array;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('book-studio', 2);
    req.onupgradeneeded = () => {
      // 판이 올라가도 기존 저장소는 그대로 두고 없는 것만 만든다
      const have = req.result.objectStoreNames;
      for (const [name, keyPath] of [['projects', 'id'], ['index', 'id'], ['fonts', 'key'], ['versions', 'key']]) {
        if (!have.contains(name)) req.result.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req ? req.result : (undefined as T));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('저장이 중단되었어요.'));
  });
}

export function summarize(p: Project): ProjectSummary {
  return {
    id: p.id, title: p.meta.title, author: p.meta.author, updatedAt: p.updatedAt,
    width: p.format.width, height: p.format.height, presetId: p.format.presetId, pageCount: p.pages.length,
  };
}

/** 프로젝트와 목록 정보를 하나의 트랜잭션으로 저장한다(중간에 종료되어도 반쯤 저장되지 않는다). */
export function saveProject(p: Project): Promise<void> {
  return tx(['projects', 'index'], 'readwrite', (t) => {
    t.objectStore('projects').put(p);
    t.objectStore('index').put(summarize(p));
  });
}

export function loadProject(id: string): Promise<Project | undefined> {
  return tx(['projects'], 'readonly', (t) => t.objectStore('projects').get(id));
}

const versionRange = (id: string) => IDBKeyRange.bound(`${id}:`, `${id}:\uffff`);

export function deleteProject(id: string): Promise<void> {
  return tx(['projects', 'index', 'versions'], 'readwrite', (t) => {
    t.objectStore('projects').delete(id);
    t.objectStore('index').delete(id);
    t.objectStore('versions').delete(versionRange(id));
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await tx<ProjectSummary[]>(['index'], 'readonly', (t) => t.objectStore('index').getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveFont(f: StoredFont): Promise<void> {
  return tx(['fonts'], 'readwrite', (t) => {
    t.objectStore('fonts').put(f);
  });
}

export function listFonts(): Promise<StoredFont[]> {
  return tx(['fonts'], 'readonly', (t) => t.objectStore('fonts').getAll());
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const safeFilename = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'book';

// ---- 이전 버전(복원 지점) ----
export interface Snapshot { key: string; id: string; at: number; pageCount: number; project: Project }
const MAX_SNAPSHOTS = 8;

export async function listSnapshots(id: string): Promise<Snapshot[]> {
  const all = await tx<Snapshot[]>(['versions'], 'readonly', (t) => t.objectStore('versions').getAll(versionRange(id)));
  return all.sort((a, b) => b.at - a.at);
}

/** 지금 상태를 복원 지점으로 남기고, 오래된 것은 지운다. */
export async function saveSnapshot(p: Project): Promise<void> {
  const at = Date.now();
  const old = (await listSnapshots(p.id)).slice(MAX_SNAPSHOTS - 1);
  await tx(['versions'], 'readwrite', (t) => {
    const store = t.objectStore('versions');
    store.put({ key: `${p.id}:${String(at).padStart(15, '0')}`, id: p.id, at, pageCount: p.pages.length, project: p });
    for (const o of old) store.delete(o.key);
  });
}
