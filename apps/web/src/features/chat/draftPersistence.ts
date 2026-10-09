import { fileToSelectedAttachment, getAttachmentFileError, releaseSelectedAttachment } from './chatAttachments';
import type { SelectedAttachment } from './types';

export interface SavedDraft {
  message: string; mode: string; model: string; quickAction: string | null; attachments: SelectedAttachment[];
}
export interface DraftPersistence {
  load(key: string): Promise<SavedDraft | null>;
  save(key: string, draft: SavedDraft): Promise<void>;
  remove(key: string): Promise<void>;
}
type StoredDraft = Omit<SavedDraft, 'attachments'> & { owner: string; key: string; savedAt: number; files: File[] };
let connection: Promise<IDBDatabase> | undefined;
function database() {
  connection ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('oddpath-private-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: ['owner', 'key'] });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = undefined; }; resolve(request.result); };
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
  return connection;
}
/** Account-scoped local drafts only; never an executable transcript or QA evidence. */
export function accountDraftPersistence(owner: () => string | undefined): DraftPersistence | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  async function transaction<T>(identity: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('drafts', mode);
      const request = action(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error(`Draft storage failed for ${identity}`));
    });
  }
  return {
    async load(key) {
      const identity = owner(); if (!identity) return null;
      const row = await transaction(identity, 'readonly', store => store.get([identity, key])) as StoredDraft | undefined;
      if (!row || row.owner !== identity || owner() !== identity) return null;
      if (Date.now() - row.savedAt > 7 * 24 * 60 * 60 * 1000) { await transaction(identity, 'readwrite', store => store.delete([identity, key])); return null; }
      if (typeof row.message !== 'string' || !Array.isArray(row.files) || row.files.length > 4) return null;
      const attachments = await Promise.all(row.files.filter(file => file instanceof File && !getAttachmentFileError(file)).map(fileToSelectedAttachment));
      if (owner() !== identity) { attachments.forEach(releaseSelectedAttachment); return null; }
      return { message: row.message, mode: row.mode, model: row.model, quickAction: row.quickAction, attachments };
    },
    async save(key, draft) {
      const identity = owner(); if (!identity) return;
      if (!draft.message && !draft.attachments.length) { await transaction(identity, 'readwrite', store => store.delete([identity, key])); return; }
      await transaction(identity, 'readwrite', store => store.put({ owner: identity, key, savedAt: Date.now(), message: draft.message, mode: draft.mode, model: draft.model, quickAction: draft.quickAction, files: draft.attachments.map(item => item.file) } satisfies StoredDraft));
    },
    async remove(key) { const identity = owner(); if (identity) await transaction(identity, 'readwrite', store => store.delete([identity, key])); },
  };
}
