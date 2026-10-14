import { EMPTY_DATA, type PublishingAccount, type ScheduleItem, type StudioData } from "./model";

const STORAGE_KEY = "repost-studio-data-v05";
const LEGACY_KEY = "repost-studio-data-v03";

function cleanArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function migrateLegacy(raw: unknown): StudioData {
  const legacy = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const oldSchedules = cleanArray<Record<string, unknown>>(legacy.schedules);
  const legacyAccount: PublishingAccount | undefined = oldSchedules.length ? {
    id: "legacy-unassigned",
    name: "Agenda antiga",
    status: "paused",
    rule: { weekdays: [1, 2, 3, 4, 5], times: ["09:00", "18:00"] },
    notes: "Conta criada automaticamente durante a migracao da agenda v0.3.",
    createdAt: typeof oldSchedules[0]?.createdAt === "string" ? oldSchedules[0].createdAt : "2026-01-01T00:00:00.000Z",
  } : undefined;

  const schedules: ScheduleItem[] = oldSchedules
    .filter((item) => typeof item.id === "string" && typeof item.videoId === "string" && typeof item.at === "string")
    .map((item) => ({
      id: item.id as string,
      videoId: item.videoId as string,
      accountId: legacyAccount?.id ?? "legacy-unassigned",
      at: item.at as string,
      status: "draft",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : item.at as string,
    }));

  return {
    version: 5,
    profiles: cleanArray(legacy.profiles),
    videos: cleanArray(legacy.videos),
    scans: cleanArray(legacy.scans),
    accounts: legacyAccount ? [legacyAccount] : [],
    schedules,
  };
}

export function loadStudio(): StudioData {
  if (typeof window === "undefined") return { ...EMPTY_DATA };
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    if (current) {
      const parsed = JSON.parse(current) as Partial<StudioData>;
      if (parsed.version === 5) {
        return {
          version: 5,
          profiles: cleanArray(parsed.profiles),
          videos: cleanArray(parsed.videos),
          scans: cleanArray(parsed.scans),
          accounts: cleanArray(parsed.accounts),
          schedules: cleanArray(parsed.schedules),
        };
      }
    }

    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrateLegacy(JSON.parse(legacy));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    return { ...EMPTY_DATA };
  }
  return { ...EMPTY_DATA };
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
