import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';

/** Track 4 — Offline beneficiary queue (IndexedDB + sync on reconnect). */
test.describe('E2E — offline enroll', () => {
  test('queues beneficiary offline then syncs when online', async ({ page }) => {
    await login(page, 'programs@indiango.org');
    await page.goto('/programs');

    const enqueued = await page.evaluate(async () => {
      const DB = 'goodjobs-field-v1';
      const STORE = 'beneficiaryCreates';
      const localId = `local-e2e-${Date.now()}`;
      const rec = {
        localId,
        payload: {
          name: 'E2E Offline Ben',
          program: 'Health',
          location: 'Pune',
          aadhaar: false,
          familySize: 1,
          details: { consent_given: true },
        },
        createdAt: new Date().toISOString(),
      };
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'localId' });
          }
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(STORE, 'readwrite');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
          tx.objectStore(STORE).add(rec);
        };
      });
      return localId;
    });
    expect(enqueued).toBeTruthy();

    const countBefore = await page.evaluate(async () => {
      const DB = 'goodjobs-field-v1';
      const STORE = 'beneficiaryCreates';
      return new Promise<number>((resolve) => {
        const req = indexedDB.open(DB, 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.close();
            resolve(0);
            return;
          }
          const tx = db.transaction(STORE, 'readonly');
          const q = tx.objectStore(STORE).getAll();
          q.onsuccess = () => {
            resolve((q.result || []).length);
            db.close();
          };
          q.onerror = () => { resolve(0); db.close(); };
        };
        req.onerror = () => resolve(0);
      });
    });
    expect(countBefore).toBeGreaterThan(0);

    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForTimeout(3000);

    const countAfter = await page.evaluate(async () => {
      const DB = 'goodjobs-field-v1';
      const STORE = 'beneficiaryCreates';
      return new Promise<number>((resolve) => {
        const req = indexedDB.open(DB, 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.close();
            resolve(0);
            return;
          }
          const tx = db.transaction(STORE, 'readonly');
          const q = tx.objectStore(STORE).getAll();
          q.onsuccess = () => {
            resolve((q.result || []).length);
            db.close();
          };
          q.onerror = () => { resolve(0); db.close(); };
        };
        req.onerror = () => resolve(0);
      });
    });
    expect(countAfter).toBeLessThan(countBefore);
  });
});
