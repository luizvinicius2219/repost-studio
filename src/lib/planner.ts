import type { PublishingAccount, ScheduleItem, VideoItem } from "./model";

export const WEEKDAYS = [
  { value: 1, short: "Seg", label: "Segunda" },
  { value: 2, short: "Ter", label: "Terca" },
  { value: 3, short: "Qua", label: "Quarta" },
  { value: 4, short: "Qui", label: "Quinta" },
  { value: 5, short: "Sex", label: "Sexta" },
  { value: 6, short: "Sab", label: "Sabado" },
  { value: 0, short: "Dom", label: "Domingo" },
] as const;

export function normalizeTimes(raw: string): string[] {
  const times = [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))];
  if (!times.length || !times.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error("Use horarios no formato 09:00,13:30,18:00.");
  }
  return times.sort();
}

export function accountDisplay(account?: PublishingAccount) {
  if (!account) return "Conta removida";
  return account.username ? `${account.name} (@${account.username})` : account.name;
}

export function availableVideosForAccount(videos: VideoItem[], schedules: ScheduleItem[], accountId: string) {
  const used = new Set(
    schedules
      .filter((s) => s.accountId === accountId && s.status !== "canceled")
      .map((s) => s.videoId),
  );
  return videos.filter((v) => !!v.fileId && !used.has(v.id));
}

export function buildFutureSlots(args: {
  account: PublishingAccount;
  schedules: ScheduleItem[];
  startDate: string;
  count: number;
  nowMs: number;
}): string[] {
  const { account, schedules, startDate, count, nowMs } = args;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Escolha uma data inicial valida.");
  if (!account.rule.weekdays.length) throw new Error("A conta precisa ter pelo menos um dia da semana ativo.");
  if (!account.rule.times.length) throw new Error("A conta precisa ter pelo menos um horario configurado.");

  const baseDate = new Date(`${startDate}T12:00:00`);
  if (Number.isNaN(baseDate.getTime())) throw new Error("Escolha uma data inicial valida.");

  const occupied = new Set(
    schedules
      .filter((s) => s.accountId === account.id && s.status !== "canceled")
      .map((s) => s.at),
  );
  const slots: string[] = [];
  const limit = Math.max(1, Math.min(count, 500));

  for (let day = 0; day < 730 && slots.length < limit; day++) {
    const date = new Date(baseDate.getTime());
    date.setDate(baseDate.getDate() + day);
    if (!account.rule.weekdays.includes(date.getDay())) continue;

    for (const time of account.rule.times) {
      const [hour, minute] = time.split(":").map(Number);
      const slot = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
      if (slot.getTime() <= nowMs) continue;
      const iso = slot.toISOString();
      if (occupied.has(iso)) continue;
      slots.push(iso);
      if (slots.length >= limit) break;
    }
  }
  return slots;
}

export function startOfWeek(dateText: string): Date {
  const d = new Date(`${dateText}T12:00:00`);
  const delta = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + delta);
  d.setHours(12, 0, 0, 0);
  return d;
}

export function isoDateLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function weekDates(anchor: string): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getTime());
    d.setDate(start.getDate() + i);
    return d;
  });
}
