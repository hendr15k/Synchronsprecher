const DB_NAME = 'ElevenReaderCache';
const STORE_NAME = 'audio_chunks_v1';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function getDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      
      request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = (e: any) => {
        resolve(e.target.result);
      };

      request.onerror = () => {
        resolve(null);
      };
    });
  }

  return dbPromise;
}

// Simple wrapper for IndexedDB to persist generated audio and save API quota
export const audioCache = {
  async get(key: string): Promise<string | null> {
    const db = await getDB();
    if (!db) return null;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const getReq = store.get(key);
            
            getReq.onsuccess = () => resolve(getReq.result || null);
            getReq.onerror = () => resolve(null);
        } catch (err) {
            resolve(null);
        }
    });
  },

  async set(key: string, data: string): Promise<void> {
    const db = await getDB();
    if (!db) return;

    try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(data, key);
    } catch (err) {
        console.warn("Failed to cache audio", err);
    }
  },

  // Helper to generate a unique key for the request
  generateKey(text: string, voice: string, mode: string): string {
    // Simple hash function for the key
    let hash = 0;
    const str = `${text}|${voice}|${mode}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `audio_${hash}`;
  }
};
