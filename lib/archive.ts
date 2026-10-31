export type Reliability = "high" | "medium" | "low";

export type ArchiveRecordType =
  | "homepage"
  | "forum"
  | "guestbook"
  | "server_log"
  | "profile"
  | "metadata_report"
  | "forum_capture"
  | "system_trace";

export interface ArchiveRecord {
  id: string;
  title: string;
  type: ArchiveRecordType;
  date: string;
  author: string;
  content: string;
  tags: string[];
  reliability: Reliability;
}

const recordTypes = new Set<ArchiveRecordType>([
  "homepage", "forum", "guestbook", "server_log", "profile", "metadata_report", "forum_capture", "system_trace",
]);
const reliabilities = new Set<Reliability>(["high", "medium", "low"]);

export function isArchiveRecord(value: unknown): value is ArchiveRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && /^ARC-\d{3}$/.test(record.id)
    && typeof record.title === "string" && record.title.trim().length > 0
    && typeof record.type === "string" && recordTypes.has(record.type as ArchiveRecordType)
    && typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.date)
    && typeof record.author === "string" && record.author.trim().length > 0
    && typeof record.content === "string" && record.content.trim().length > 0
    && Array.isArray(record.tags) && record.tags.length > 0
    && record.tags.every((tag) => typeof tag === "string" && tag.trim().length > 0)
    && typeof record.reliability === "string" && reliabilities.has(record.reliability as Reliability);
}

export function validateArchive(value: unknown): value is ArchiveRecord[] {
  if (!Array.isArray(value) || value.length !== 9 || !value.every(isArchiveRecord)) return false;
  const ids = value.map(({ id }) => id);
  return new Set(ids).size === ids.length;
}
