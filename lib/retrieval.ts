import archiveData from "../data/archive.json";

export type Reliability = "high" | "medium" | "low";

export interface ArchiveRecord {
  id: string;
  title: string;
  type: string;
  date: string;
  author: string;
  content: string;
  tags: string[];
  reliability: Reliability;
}

const archive = archiveData as ArchiveRecord[];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "be", "been", "by", "can", "could", "did", "do", "does",
  "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "this", "that",
  "to", "was", "were", "what", "when", "where", "which", "who", "why", "with", "would",
]);

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function scoreRecord(record: ArchiveRecord, query: string, terms: string[]): number {
  const title = normalize(record.title);
  const content = normalize(record.content);
  const author = normalize(record.author);
  const tags = record.tags.map(normalize);
  let score = 0;

  if (title.includes(query)) score += 12;
  if (content.includes(query)) score += 8;
  if (author.includes(query)) score += 10;
  if (tags.some((tag) => tag.includes(query))) score += 10;

  for (const term of terms) {
    if (title.includes(term)) score += 4;
    if (content.includes(term)) score += 2;
    if (author.includes(term)) score += 3;
    if (tags.some((tag) => tag.includes(term))) score += 3;
  }

  return score;
}

/** Search archive titles, content, authors, and tags with deterministic relevance ranking. */
export function searchArchive(query: string, limit?: number): ArchiveRecord[] {
  if (typeof query !== "string") return [];

  const normalizedQuery = normalize(query);
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
