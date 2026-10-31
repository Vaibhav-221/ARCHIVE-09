export const GAME_PROGRESS_KEY = "archive-09:game-progress";
export const GAME_PROGRESS_VERSION = 1;

export const THEORY_IDS = [
  "orphaned-process",
  "human-maintained",
  "autonomous-operator",
  "orphaned_process",
  "human_maintained",
  "autonomous_operator",
] as const;
export type TheoryId = (typeof THEORY_IDS)[number];

export function normalizeTheoryId(value: string): "orphaned-process" | "human-maintained" | "autonomous-operator" | null {
  const normalized = value.replace(/_/g, "-");
  if (normalized === "orphaned-process" || normalized === "human-maintained" || normalized === "autonomous-operator") {
    return normalized;
  }
  return null;
}

export interface TheorySubmission {
  theoryId: TheoryId;
  supportingEvidenceIds: string[];
  counterEvidenceIds: string[];
  unresolvedQuestion: string;
}

export interface PersistedGameProgress {
  version: typeof GAME_PROGRESS_VERSION;
  evidenceIds: string[];
  submission: TheorySubmission | null;
  ending: { id: "partial-reveal"; completedAt: string } | null;
}

export interface StorageWriter {
  setItem(key: string, value: string): void;
}

export function persistEvidenceIds(storage: StorageWriter, key: string, evidenceIds: string[]): boolean {
  try {
    storage.setItem(key, JSON.stringify(evidenceIds));
    return true;
  } catch {
    return false;
  }
}

export function createEmptyGameProgress(evidenceIds: string[] = []): PersistedGameProgress {
  return { version: GAME_PROGRESS_VERSION, evidenceIds, submission: null, ending: null };
}

function isTheoryId(value: unknown): value is TheoryId {
  return typeof value === "string" && THEORY_IDS.includes(value as TheoryId);
}

function validIds(value: unknown, knownIds: Set<string>): string[] | null {
  if (!Array.isArray(value) || value.length > knownIds.size) return null;
  const ids = value.filter((id): id is string => typeof id === "string");
  if (ids.length !== value.length || new Set(ids).size !== ids.length || ids.some((id) => !knownIds.has(id))) return null;
  return ids;
}

export function parseGameProgress(raw: string | null, archiveIds: string[]): PersistedGameProgress | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (value.version !== GAME_PROGRESS_VERSION) return null;
    const knownIds = new Set(archiveIds);
    const evidenceIds = validIds(value.evidenceIds, knownIds);
    if (!evidenceIds) return null;

    let submission: TheorySubmission | null = null;
    if (value.submission !== null && value.submission !== undefined) {
      if (typeof value.submission !== "object") return null;
      const source = value.submission as Record<string, unknown>;
      const supportingEvidenceIds = validIds(source.supportingEvidenceIds, knownIds);
      const counterEvidenceIds = validIds(source.counterEvidenceIds, knownIds);
      if (
        !isTheoryId(source.theoryId)
        || !supportingEvidenceIds
        || !counterEvidenceIds
        || typeof source.unresolvedQuestion !== "string"
        || source.unresolvedQuestion.length > 300
      ) return null;
      submission = {
        theoryId: source.theoryId,
        supportingEvidenceIds,
        counterEvidenceIds,
        unresolvedQuestion: source.unresolvedQuestion,
      };
    }

    let ending: PersistedGameProgress["ending"] = null;
    if (value.ending !== null && value.ending !== undefined) {
      if (typeof value.ending !== "object") return null;
      const savedEnding = value.ending as Record<string, unknown>;
      if (savedEnding.id !== "partial-reveal" || typeof savedEnding.completedAt !== "string" || !Number.isFinite(Date.parse(savedEnding.completedAt))) return null;
      if (!submission) return null;
      ending = { id: "partial-reveal", completedAt: savedEnding.completedAt };
    }

    return { version: GAME_PROGRESS_VERSION, evidenceIds, submission, ending };
  } catch {
    return null;
  }
}

export function persistGameProgress(storage: StorageWriter, progress: PersistedGameProgress): boolean {
  try {
    storage.setItem(GAME_PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
