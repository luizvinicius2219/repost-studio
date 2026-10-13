import { EMPTY_DATA, type StudioData } from "./model";

const STORAGE_KEY = "repost-studio-data-v03";

export function loadStudio(): StudioData {
  if (typeof window === "undefined") return { ...EMPTY_DATA };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 3, profiles: [], videos: [], scans: [], schedules: [] };
    const v = JSON.parse(raw) as Partial<StudioData>;
    if (v.version !== 3 || !Array.isArray(v.profiles) || !Array.isArray(v.videos) || !Array.isArray(v.scans) || !Array.isArray(v.schedules)) {
      throw new Error("Formato invalido");
    }
    return v as StudioData;
  } catch {
    return { version: 3, profiles: [], videos: [], scans: [], schedules: [] };
  }
}

export function saveStudio(value: StudioData): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function exportStudio(value: StudioData) {
  const data = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `repost-studio-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
