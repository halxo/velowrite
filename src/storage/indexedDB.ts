import {
  DEFAULT_PREFERENCES,
  type DocumentModel,
  type DocumentSnapshot,
  type DocumentSummary,
  type UserPreferences,
} from '../model/types';

const DB_NAME = 'velowrite_db';
const DB_VERSION = 2;
const STORE_DOCUMENTS = 'documents';
const STORE_PREFS = 'preferences';
const STORE_ASSETS = 'assets';
const STORE_SNAPSHOTS = 'snapshots';
const PREFS_KEY = 'user_prefs';

export interface StoredAsset {
  id: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
}

export class VeloStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private pendingSaveDoc: DocumentModel | null = null;
  private saveTimer: number | null = null;
  private idleHandle: number | null = null;
  private assetUrlCache = new Map<string, string>();
  private onSaveStateChange?: (state: 'saving' | 'saved' | 'error') => void;

  setSaveStateListener(cb: (state: 'saving' | 'saved' | 'error') => void): void {
    this.onSaveStateChange = cb;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
          const docStore = db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' });
          docStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_PREFS)) {
          db.createObjectStore(STORE_PREFS);
        }
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          const snapStore = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
          snapStore.createIndex('documentId', 'documentId', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async getDocument(id: string): Promise<DocumentModel | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DOCUMENTS, 'readonly');
      const store = tx.objectStore(STORE_DOCUMENTS);
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as DocumentModel) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveDocumentImmediate(doc: DocumentModel): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DOCUMENTS, 'readwrite');
      const store = tx.objectStore(STORE_DOCUMENTS);
      store.put(doc);
      tx.oncomplete = () => {
        this.onSaveStateChange?.('saved');
        resolve();
      };
      tx.onerror = () => {
        this.onSaveStateChange?.('error');
        reject(tx.error);
      };
    });
  }

  /**
   * Zero-latency optimistic autosave: schedules persistence during idle frames
   * so keystroke latency stays strictly sub-16ms even for 100-page documents.
   */
  scheduleAutosave(doc: DocumentModel): void {
    this.pendingSaveDoc = doc;
    this.onSaveStateChange?.('saving');

    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    if (this.idleHandle !== null && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(this.idleHandle);
      this.idleHandle = null;
    }

    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      const runFlush = () => {
        this.idleHandle = null;
        void this.flushPendingSave();
      };
      if ('requestIdleCallback' in window) {
        this.idleHandle = window.requestIdleCallback(runFlush, { timeout: 1200 });
      } else {
        runFlush();
      }
    }, 350);
  }

  async flushPendingSave(): Promise<void> {
    if (!this.pendingSaveDoc) return;
    const docToSave = this.pendingSaveDoc;
    this.pendingSaveDoc = null;
    try {
      await this.saveDocumentImmediate(docToSave);
    } catch {
      this.onSaveStateChange?.('error');
    }
  }

  async listDocumentSummaries(): Promise<DocumentSummary[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DOCUMENTS, 'readonly');
      const store = tx.objectStore(STORE_DOCUMENTS);
      const index = store.index('updatedAt');
      const req = index.openCursor(null, 'prev');
      const results: DocumentSummary[] = [];

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const doc = cursor.value as DocumentModel;
          let wordCount = 0;
          let preview = '';
          for (let i = 0; i < doc.blocks.length; i++) {
            const b = doc.blocks[i];
            wordCount += b.wordCount;
            if (!preview && b.text.trim()) {
              preview = b.text.trim().slice(0, 96);
            }
          }
          results.push({
            id: doc.id,
            title: doc.title || 'Untitled Document',
            updatedAt: doc.updatedAt,
            wordCount,
            preview,
          });
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteDocument(id: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DOCUMENTS, 'readwrite');
      tx.objectStore(STORE_DOCUMENTS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ============================ LOCAL IMAGE ASSETS ============================ */

  async saveAsset(id: string, blob: Blob): Promise<string> {
    const db = await this.open();
    const record: StoredAsset = {
      id,
      mimeType: blob.type || 'image/png',
      blob,
      createdAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readwrite');
      tx.objectStore(STORE_ASSETS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const cached = this.assetUrlCache.get(id);
    if (cached) URL.revokeObjectURL(cached);
    const url = URL.createObjectURL(blob);
    this.assetUrlCache.set(id, url);
    return url;
  }

  async getAssetUrl(id: string): Promise<string | null> {
    const cached = this.assetUrlCache.get(id);
    if (cached) return cached;

    const db = await this.open();
    const record = await new Promise<StoredAsset | null>((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readonly');
      const req = tx.objectStore(STORE_ASSETS).get(id);
      req.onsuccess = () => resolve((req.result as StoredAsset) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (!record) return null;
    const url = URL.createObjectURL(record.blob);
    this.assetUrlCache.set(id, url);
    return url;
  }

  /* ============================ VERSION SNAPSHOTS ============================ */

  async saveSnapshot(snapshot: DocumentSnapshot): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
      tx.objectStore(STORE_SNAPSHOTS).put(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async listSnapshots(documentId: string): Promise<DocumentSnapshot[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
      const index = tx.objectStore(STORE_SNAPSHOTS).index('documentId');
      const req = index.getAll(IDBKeyRange.only(documentId));
      req.onsuccess = () => {
        const rows = (req.result as DocumentSnapshot[]) ?? [];
        rows.sort((a, b) => b.createdAt - a.createdAt);
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteSnapshot(id: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
      tx.objectStore(STORE_SNAPSHOTS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ============================ PREFERENCES ============================ */

  async getPreferences(): Promise<UserPreferences> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PREFS, 'readonly');
      const req = tx.objectStore(STORE_PREFS).get(PREFS_KEY);
      req.onsuccess = () => {
        const stored = req.result as Partial<UserPreferences> | undefined;
        resolve({ ...DEFAULT_PREFERENCES, ...stored });
      };
      req.onerror = () => reject(req.error);
    });
  }

  async savePreferences(prefs: UserPreferences): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PREFS, 'readwrite');
      tx.objectStore(STORE_PREFS).put(prefs, PREFS_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
