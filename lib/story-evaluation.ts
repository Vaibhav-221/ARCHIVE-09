import type { ArchiveRecord } from "./archive";
import type { TheoryId, TheorySubmission } from "./game-progress";

export function normalizeTheoryId(id: string): "orphaned-process" | "human-maintained" | "autonomous-operator" | null {
  const normalized = id.replace(/_/g, "-");
  if (normalized === "orphaned-process" || normalized === "human-maintained" || normalized === "autonomous-operator") {
    return normalized;
  }
  return null;
}

const evidenceForTheory: Record<"orphaned-process" | "human-maintained" | "autonomous-operator", { supports: string[]; complicates: string[] }> = {
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

const recordEvidentialNotes: Record<string, {
  supportLimitation?: Record<string, string>;
  counterLimitation?: Record<string, string>;
  generalLimitation: string;
}> = {
  "ARC-001": {
    generalLimitation: "ARC-001 documents the announced closure, but the surviving mirror files show maintenance tasks remained scheduled.",
    counterLimitation: {
      "orphaned-process": "ARC-001 documents the announced closure, but the surviving mirror files show maintenance tasks remained scheduled.",
    },
  },
  "ARC-002": {
    generalLimitation: "ARC-002 reports an anomalous reply counter, suggesting post-shutdown activity or counter desynchronization, but does not identify the cause.",
  },
  "ARC-003": {
    generalLimitation: "The guestbook message introduces an unexplained clue. Its unknown author and low reliability mean it does not directly establish the orphaned process or identify the operator.",
    supportLimitation: {
      "orphaned-process": "The guestbook message introduces an unexplained clue. Its unknown author and low reliability mean it does not directly establish the orphaned process or identify the operator.",
    },
    counterLimitation: {
      "orphaned-process": "The guestbook message introduces an unexplained clue, but its unknown author and low reliability prevent it from disproving the maintenance process.",
    },
  },
  "ARC-004": {
    generalLimitation: "The mirror successfully served an archived page. This does not prove that a new post was authored.",
    counterLimitation: {
      "orphaned-process": "The mirror successfully served an archived page. This does not prove that a new post was authored, but it does not contradict a surviving automated maintenance process.",
    },
  },
  "ARC-005": {
    generalLimitation: "ARC-005 establishes that users maintained independent backups, but does not prove who operated the surviving mirror.",
    counterLimitation: {
      "orphaned-process": "ARC-005 establishes that users maintained independent backups, but does not disprove the server-side cron configuration on mirror-02.",
    },
  },
  "ARC-006": {
    generalLimitation: "The surviving KEEPALIVE configuration is direct evidence that maintenance-task configuration remained after the owner account was disabled. It does not, by itself, prove which anomalies the task generated.",
    counterLimitation: {
      "orphaned-process": "The surviving KEEPALIVE configuration is direct evidence that maintenance-task configuration remained after the owner account was disabled. It does not, by itself, prove which anomalies the task generated, but it directly aligns with the orphaned-process explanation rather than contradicting it.",
    },
  },
  "ARC-007": {
    generalLimitation: "The original timestamp and mirror export timestamp refer to different operations. The export timestamp is not proof of the original post's creation or edit time.",
    counterLimitation: {
      "orphaned-process": "ARC-007 distinguishes the original record timestamp from the mirror export timestamp. This cautions against treating the export time as proof of when the original post was written, but it does not directly disprove the existence of the surviving maintenance process.",
    },
  },
  "ARC-008": {
    generalLimitation: "A reply reference exists, but the body and original database record were not recovered. This is a genuine unresolved anomaly, but it does not prove a ghost, autonomous operator, or any specific cause.",
    supportLimitation: {
      "orphaned-process": "A reply reference exists, but the body and original database record were not recovered. This is a genuine unresolved anomaly, but it does not prove a ghost, autonomous operator, or any specific cause.",
    },
  },
  "ARC-009": {
    generalLimitation: "ARC-009 contains an unverified query token matching the guestbook, but does not prove who or what initiated the trace.",
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

  const normalizedTheory = normalizeTheoryId(submission.theoryId);
  if (!normalizedTheory) throw new Error("Theory submission contains an unknown theory ID.");

  const map = evidenceForTheory[normalizedTheory];
  const matchedSupport = submission.supportingEvidenceIds.filter((id) => map.supports.includes(id));
  const matchedCounter = submission.counterEvidenceIds.filter((id) => map.complicates.includes(id));
  const unusedSupport = submission.supportingEvidenceIds.filter((id) => !map.supports.includes(id));
  const unmatchedCounter = submission.counterEvidenceIds.filter((id) => !map.complicates.includes(id));

  const careful = matchedSupport.length >= 2 && matchedCounter.length >= 1 && submission.unresolvedQuestion.trim().length >= 8;

  let theoryAssessment: TheoryEvaluation["theoryAssessment"] = "not-established";
  if (matchedSupport.length >= 2) {
    if (
      normalizedTheory === "orphaned-process"
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
    for (const id of unusedSupport) {
      const note = recordEvidentialNotes[id]?.supportLimitation?.[normalizedTheory] ?? recordEvidentialNotes[id]?.generalLimitation;
      if (note) {
        feedback.push(note);
      }
    }
  }

  if (submission.counterEvidenceIds.length === 0) {
    feedback.push("The submission does not yet identify a recovered record that complicates this theory.");
  } else {
    if (matchedCounter.length > 0) {
      feedback.push(`You considered records that complicate the theory (${matchedCounter.join(", ")}).`);
    }
    if (unmatchedCounter.length > 0) {
      for (const id of unmatchedCounter) {
        feedback.push(`You marked ${id} as complicating evidence.`);
        const note = recordEvidentialNotes[id]?.counterLimitation?.[normalizedTheory] ?? recordEvidentialNotes[id]?.generalLimitation;
        if (note) {
          feedback.push(note);
        }
      }
      if (matchedCounter.length === 0) {
        feedback.push("The selected complicating evidence does not decisively contradict this theory.");
      }
    }
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
