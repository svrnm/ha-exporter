import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useInstances } from '../api/hooks.js';

const STORAGE_KEY = 'ha_exporter_instance';

const InstanceContext = createContext(null);

export function InstanceProvider({ children }) {
  const { data: instances = [], isLoading, error } = useInstances();
  const [selected, setSelected] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  // After a full remote wipe, /instances is empty until the next ingest —
  // keep a stable selection so the UI does not call APIs with a stale id.
  useEffect(() => {
    if (!instances.length) {
      if (selected) setSelected('');
      return;
    }
    if (!selected || !instances.find((i) => i.instance_id === selected)) {
      setSelected(instances[0].instance_id);
    }
  }, [instances, selected]);

  useEffect(() => {
    try {
      if (selected) localStorage.setItem(STORAGE_KEY, selected);
    } catch {
      // ignore
    }
  }, [selected]);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.instance_id === selected) ?? null,
    [instances, selected],
  );

  const value = useMemo(
    () => ({
      instances,
      isLoading,
      error,
      selected,
      setSelected,
      selectedInstance,
    }),
    [instances, isLoading, error, selected, selectedInstance],
  );

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export function useInstance() {
  const ctx = useContext(InstanceContext);
  if (!ctx) throw new Error('useInstance must be used inside <InstanceProvider>');
  return ctx;
}
