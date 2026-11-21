import { Preferences } from '@capacitor/preferences';

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const { value } = await Preferences.get({ key });
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveJSON(key: string, value: unknown): Promise<void> {
  try {
    await Preferences.set({ key, value: JSON.stringify(value) });
  } catch {
    /* armazenamento indisponível: segue só em memória */
  }
}
