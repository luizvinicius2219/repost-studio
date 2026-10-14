export type Profile = {
  id: string;
  username: string;
  url: string;
  createdAt: string;
  lastScanAt?: string;
  scanStatus: "pending" | "completed" | "partial" | "failed";
};

export type VideoItem = {
  id: string;
  source: "tiktok" | "upload";
  profileId?: string;
  externalId?: string;
  title: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  fileId?: string;
  fileName?: string;
  fingerprint?: string;
  fileSize?: number;
  createdAt: string;
};

export type ScanResult = {
  username: string;
  status: "completed" | "partial" | "blocked" | "failed";
  message: string;
  fetchedCount: number;
  videos: Array<{
    id: string;
    title: string;
    url: string;
    thumbnailUrl?: string;
  }>;
  source: "public-page";
  exhaustive: false;
};

export type ScanJob = {
  id: string;
  profileId: string;
  username: string;
  at: string;
  status: ScanResult["status"] | "running";
  found: number;
  added: number;
  message: string;
};

export type AccountRule = {
  weekdays: number[];
  times: string[];
};

export type PublishingAccount = {
  id: string;
  name: string;
  username?: string;
  status: "active" | "paused";
  rule: AccountRule;
  notes?: string;
  createdAt: string;
};

export type ScheduleStatus = "draft" | "scheduled" | "published" | "error" | "canceled";

export type ScheduleItem = {
  id: string;
  videoId: string;
  accountId: string;
  at: string;
  status: ScheduleStatus;
  createdAt: string;
  updatedAt?: string;
  publishedAt?: string;
  note?: string;
};

export type StudioData = {
  version: 5;
  profiles: Profile[];
  videos: VideoItem[];
  scans: ScanJob[];
  accounts: PublishingAccount[];
  schedules: ScheduleItem[];
};

export const EMPTY_DATA: StudioData = {
  version: 5,
  profiles: [],
  videos: [],
  scans: [],
  accounts: [],
  schedules: [],
};

export function normalizeProfileUrl(input: string): { username: string; url: string } {
  const parsed = new URL(input.trim());
  if (parsed.protocol !== "https:" || !["tiktok.com", "www.tiktok.com"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Use uma URL HTTPS de perfil TikTok.");
  }
  const match = parsed.pathname.match(/^\/@([A-Za-z0-9._]{2,30})\/?$/);
  if (!match) throw new Error("Informe a URL de um perfil: https://www.tiktok.com/@usuario");
  const username = match[1].toLowerCase();
  return { username, url: `https://www.tiktok.com/@${username}` };
}

export function normalizeVideoUrl(input: string): { username: string; id: string; url: string } {
  const parsed = new URL(input.trim());
  if (parsed.protocol !== "https:" || !["tiktok.com", "www.tiktok.com"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Use uma URL HTTPS de video do TikTok.");
  }
  const match = parsed.pathname.match(/^\/@([A-Za-z0-9._]{2,30})\/video\/(\d{10,25})\/?$/);
  if (!match) throw new Error("Use uma URL de video: https://www.tiktok.com/@usuario/video/123...");
  const username = match[1].toLowerCase();
  return { username, id: match[2], url: `https://www.tiktok.com/@${username}/video/${match[2]}` };
}

export function localTimeLabel(at: string) {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
