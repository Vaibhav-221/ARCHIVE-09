import archiveData from "@/data/archive.json";
import { validateArchive } from "@/lib/archive";
import { readLimitedJson } from "@/lib/request-body";
import { THEORY_IDS, type TheoryId, type TheorySubmission } from "@/lib/game-progress";
import { evaluateTheory } from "@/lib/story-evaluation";

const MAX_REQUEST_BYTES = 12_288;
const MAX_UNRESOLVED_QUESTION = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIds(value: unknown, knownIds: Set<string>): string[] | null {
  if (!Array.isArray(value) || value.length > knownIds.size) return null;
  if (!value.every((id) => typeof id === "string" && knownIds.has(id))) return null;
  const ids = value as string[];
  return new Set(ids).size === ids.length ? ids : null;
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }

  const parsed = await readLimitedJson(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) {
    return Response.json(
      { error: parsed.reason === "too-large" ? "The request body is too large." : "Request body must be valid JSON." },
      { status: parsed.reason === "too-large" ? 413 : 400 }
    );
  }
  if (!isRecord(parsed.value)) return Response.json({ error: "A theory submission is required." }, { status: 400 });

  const allowedKeys = new Set(["theoryId", "supportingEvidenceIds", "counterEvidenceIds", "unresolvedQuestion", "collectedEvidenceIds"]);
  if (Object.keys(parsed.value).some((key) => !allowedKeys.has(key))) {
    return Response.json({ error: "The submission contains unsupported fields." }, { status: 400 });
  }

  if (!validateArchive(archiveData)) {
    return Response.json({ error: "The recovered archive could not be validated." }, { status: 500 });
  }
  const knownIds = new Set(archiveData.map(({ id }) => id));
  const { theoryId, unresolvedQuestion } = parsed.value;
  const supportingEvidenceIds = parseIds(parsed.value.supportingEvidenceIds, knownIds);
  const counterEvidenceIds = parseIds(parsed.value.counterEvidenceIds, knownIds);
  const collectedEvidenceIds = parseIds(parsed.value.collectedEvidenceIds, knownIds);

  if (typeof theoryId !== "string" || !THEORY_IDS.includes(theoryId as TheoryId)) {
    return Response.json({ error: "Choose one of the available investigation theories." }, { status: 400 });
  }
  if (!supportingEvidenceIds || !counterEvidenceIds || !collectedEvidenceIds) {
    return Response.json({ error: "Evidence selections must contain valid, unique archive IDs." }, { status: 400 });
  }
  if (supportingEvidenceIds.length < 2 || counterEvidenceIds.length < 1) {
    return Response.json({ error: "Select at least two supporting records and one record that complicates your theory." }, { status: 400 });
  }
  if (supportingEvidenceIds.some((id) => counterEvidenceIds.includes(id))) {
    return Response.json({ error: "A record can be assigned only one role in this submission." }, { status: 400 });
  }
  if (![...supportingEvidenceIds, ...counterEvidenceIds].every((id) => collectedEvidenceIds.includes(id))) {
    return Response.json({ error: "Only collected evidence can be included in the submission." }, { status: 400 });
  }
  if (typeof unresolvedQuestion !== "string" || unresolvedQuestion.length > MAX_UNRESOLVED_QUESTION) {
    return Response.json({ error: `The unresolved question must be ${MAX_UNRESOLVED_QUESTION} characters or fewer.` }, { status: 400 });
  }

  const submission: TheorySubmission = {
    theoryId: theoryId as TheoryId,
    supportingEvidenceIds,
    counterEvidenceIds,
    unresolvedQuestion: unresolvedQuestion.trim(),
  };

  try {
    const evaluation = evaluateTheory(submission, archiveData, new Date().toISOString());
    return Response.json({ evaluation });
  } catch {
    return Response.json({ error: "The theory could not be evaluated." }, { status: 500 });
  }
}
