import type { ArchiveRecord } from "./archive";
import type { TheoryId, TheorySubmission } from "./game-progress";

const evidenceForTheory: Record<TheoryId, { supports: string[]; complicates: string[] }> = {
  "orphaned-process": {
    supports: ["ARC-001", "ARC-004", "ARC-006", "ARC-007"],
    complicates: ["ARC-002", "ARC-008", "ARC-009"],
  },
  "human-maintained": {
    supports: ["ARC-002", "ARC-004", "ARC-005", "ARC-008"],
    complicates: ["ARC-006", "ARC-007", "ARC-009"],
  },
  "autonomous-operator": {
    supports: ["ARC-003", "ARC-006", "ARC-008", "ARC-009"],
    complicates: ["ARC-001", "ARC-004", "ARC-005", "ARC-007"],
  },
};

const conclusion = "October Online's mirror retained a maintenance process after the announced shutdown. That process and the handling of archived data explain some apparent post-shutdown activity and timestamp discrepancies. The surviving evidence does not establish the source of every anomaly or identify the operator.";

export interface TheoryEvaluation {
  theoryId: TheoryId;
  theoryAssessment: "best-supported" | "plausible-not-proven" | "not-established";
  reasoningAssessment: "careful" | "developing";
  supportingEvidenceIds: string[];
  counterEvidenceIds: string[];
  feedback: string[];
  conclusion: string;
  endingId: "partial-reveal";
  completedAt: string;
}

export function evaluateTheory(
  submission: TheorySubmission,
  archive: ArchiveRecord[],
  completedAt: string
): TheoryEvaluation {
  const allowedIds = new Set(archive.map(({ id }) => id));
  if (
    !submission.supportingEvidenceIds.every((id) => allowedIds.has(id))
    || !submission.counterEvidenceIds.every((id) => allowedIds.has(id))
  ) throw new Error("Theory submission contains an unknown evidence ID.");

  const map = evidenceForTheory[submission.theoryId];
  const matchedSupport = submission.supportingEvidenceIds.filter((id) => map.supports.includes(id));
  const matchedCounter = submission.counterEvidenceIds.filter((id) => map.complicates.includes(id));
  const unusedSupport = submission.supportingEvidenceIds.filter((id) => !map.supports.includes(id));
  const careful = matchedSupport.length >= 2 && matchedCounter.length >= 1 && submission.unresolvedQuestion.trim().length >= 8;

  let theoryAssessment: TheoryEvaluation["theoryAssessment"] = "not-established";
  if (matchedSupport.length >= 2) {
    if (
      submission.theoryId === "orphaned-process"
      && matchedSupport.includes("ARC-006")
      && (matchedSupport.includes("ARC-004") || matchedSupport.includes("ARC-007"))
    ) theoryAssessment = "best-supported";
    else theoryAssessment = "plausible-not-proven";
  }

  const feedback: string[] = [];
  if (matchedSupport.length >= 2) {
    feedback.push(`Your selected sources provide evidence relevant to this theory (${matchedSupport.join(", ")}).`);
  } else {
    feedback.push("The selected sources do not yet establish this explanation. Consider which records directly support it.");
  }
  if (unusedSupport.length > 0) {
    feedback.push(`Some selected support records fit better as context or counter-evidence: ${unusedSupport.join(", ")}.`);
  }
  if (matchedCounter.length > 0) {
    feedback.push(`You considered records that complicate the theory (${matchedCounter.join(", ")}).`);
  } else {
    feedback.push("The submission does not yet identify a recovered record that complicates this theory.");
  }
  if (submission.unresolvedQuestion.trim()) {
    feedback.push("Your unresolved question is retained as part of the completed investigation.");
  }

  return {
    theoryId: submission.theoryId,
    theoryAssessment,
    reasoningAssessment: careful ? "careful" : "developing",
    supportingEvidenceIds: submission.supportingEvidenceIds,
    counterEvidenceIds: submission.counterEvidenceIds,
    feedback,
    conclusion,
    endingId: "partial-reveal",
    completedAt,
  };
}
