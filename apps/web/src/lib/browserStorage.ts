function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getLocalStorageItem<T extends string | null>(key: string, fallback: T): string | T {
  const storage = getLocalStorage();
  if (!storage) return fallback;

  try {
    return storage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function setLocalStorageItem(key: string, value: string): boolean {
  const storage = getLocalStorage();
  if (!storage) return false;

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeLocalStorageItem(key: string): boolean {
  const storage = getLocalStorage();
  if (!storage) return false;

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
