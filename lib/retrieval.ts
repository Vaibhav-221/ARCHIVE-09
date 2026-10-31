import archiveData from "../data/archive.json";
import type { ArchiveRecord } from "./archive";
export type { ArchiveRecord, ArchiveRecordType, Reliability } from "./archive";

const archive = archiveData as ArchiveRecord[];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "be", "been", "by", "can", "could", "did", "do", "does",
  "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "this", "that",
  "to", "was", "were", "what", "when", "where", "which", "who", "why", "with", "would",
]);

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function scoreRecord(record: ArchiveRecord, query: string, terms: string[]): number {
  const fields = [
    { value: record.id, phrase: 18, token: 6 },
    { value: record.title, phrase: 16, token: 5 },
    { value: record.content, phrase: 10, token: 2 },
    { value: record.author, phrase: 12, token: 4 },
    { value: record.type.replaceAll("_", " "), phrase: 10, token: 4 },
    { value: record.date, phrase: 14, token: 5 },
    ...record.tags.map((tag) => ({ value: tag.replaceAll("-", " "), phrase: 13, token: 5 })),
  ];

  let score = 0;
  for (const field of fields) {
    const normalized = normalizeSearchText(field.value);
    if (normalized === query) score += field.phrase + 4;
    else if (normalized.includes(query)) score += field.phrase;
    const fieldTerms = new Set(normalized.split(" "));
    for (const term of terms) {
      if (fieldTerms.has(term)) score += field.token;
    }
  }
  return score;
}

/** Search all player-visible archive fields with deterministic, Unicode-aware ranking. */
export function searchArchive(query: string, limit?: number): ArchiveRecord[] {
  if (typeof query !== "string") return [];

  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit as number) : DEFAULT_LIMIT;
  const resultLimit = Math.min(MAX_LIMIT, Math.max(0, requestedLimit));
  if (resultLimit === 0) return [];

  const terms = normalizedQuery.split(" ").filter((term) => term && !STOP_WORDS.has(term));
  if (terms.length === 0) return [];

  return archive
    .map((record, index) => ({ record, index, score: scoreRecord(record, normalizedQuery, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, resultLimit)
    .map(({ record }) => record);
}
