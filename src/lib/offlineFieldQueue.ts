/**
 * IndexedDB queue for beneficiary creates when the device is offline.
 * Survives page reload; flushed on `online` via `flushOfflineBeneficiaryCreates`.
 */
const DB = 'goodjobs-field-v1';
const STORE = 'beneficiaryCreates';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'localId', autoIncrement: false });
      }
    };
  });
}

export type OfflineBenPayload = {
  name: string;
  program: string;
  location: string;
  aadhaar: boolean;
  familySize: number;
  details?: Record<string, unknown>;
};

export async function enqueueOfflineBeneficiaryCreate(payload: OfflineBenPayload): Promise<string> {
  const db = await openDb();
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const rec = { localId, payload, createdAt: new Date().toISOString() };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).add(rec);
  });
  db.close();
  return localId;
}

export async function listQueuedBeneficiaryCreates(): Promise<{ localId: string; payload: OfflineBenPayload }[]> {
  const db = await openDb();
  const rows = await new Promise<{ localId: string; payload: OfflineBenPayload }[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const q = tx.objectStore(STORE).getAll();
    q.onsuccess = () => {
      const v = (q.result || []) as { localId: string; payload: OfflineBenPayload }[];
      resolve(v);
    };
    q.onerror = () => reject(q.error);
  });
  db.close();
  return rows;
}

export async function removeQueuedBeneficiaryCreate(localId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).delete(localId);
  });
  db.close();
}

type ApiFetch = (path: string, init?: import('../api/client').ApiFetchInit) => Promise<Response>;

export async function flushOfflineBeneficiaryCreates(apiFetch: ApiFetch): Promise<{ flushed: number; errors: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { flushed: 0, errors: 0 };
  }
  const rows = await listQueuedBeneficiaryCreates();
  let flushed = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const res = await apiFetch('/programs/beneficiaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row.payload),
      });
      if (!res.ok) {
        errors++;
        continue;
      }
      await removeQueuedBeneficiaryCreate(row.localId);
      flushed++;
    } catch {
      errors++;
    }
  }
  if (flushed > 0) {
    try {
      window.dispatchEvent(new Event('goodjobs:store:changed'));
    } catch {
      /* ignore */
    }
  }
  return { flushed, errors };
}
