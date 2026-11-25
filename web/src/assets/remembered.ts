/**
 * Remember folders between visits (a FileSystemDirectoryHandle can be stored in IndexedDB): the game install and the saved games folder.
 * Failures are ignored: it is a convenience.
 */
const DB = "otm";
const STORE = "handles";

/** What a remembered folder is for. `gameFolder` is the key earlier versions used, kept so a folder chosen then is still found. */
export type RememberedFolder = "gameFolder" | "savesFolder";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function rememberFolder(key: RememberedFolder, handle: FileSystemDirectoryHandle | null): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      if (handle) tx.objectStore(STORE).put(handle, key);
      else tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export async function recallFolder(key: RememberedFolder): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
