import React, { useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';

/** Dispatched after Zustand mutations (debounced) so Today / brief caches can refresh. */
export const STORE_CHANGED_EVENT = 'goodjobs:store:changed';

/**
 * Subscribes once to the root store and broadcasts {@link STORE_CHANGED_EVENT}
 * after a short debounce whenever state changes.
 */
const StoreChangedBridge: React.FC = () => {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = useStore.subscribe((_state, prev) => {
      if (prev == null) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        try {
          window.dispatchEvent(new Event(STORE_CHANGED_EVENT));
        } catch {
          /* ignore */
        }
      }, 500);
    });
    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
  return null;
};

export default StoreChangedBridge;
