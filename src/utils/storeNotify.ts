import { STORE_CHANGED_EVENT } from '../components/System/StoreChangedBridge';
import { emitAppRefresh } from './events';

/** Fire immediately after optimistic local store updates (before background sync). */
export function notifyStoreChanged(): void {
  try {
    window.dispatchEvent(new Event(STORE_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
  emitAppRefresh();
}
