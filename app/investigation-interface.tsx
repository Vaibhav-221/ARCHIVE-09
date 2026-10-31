"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import type { ArchiveRecord } from "@/lib/archive";
import {
  createEmptyGameProgress,
  GAME_PROGRESS_KEY,
  parseGameProgress,
  persistEvidenceIds,
  persistGameProgress,
  type PersistedGameProgress,
  type TheoryId,
  type TheorySubmission,
} from "@/lib/game-progress";

type SectionKey = "home" | "forum" | "guestbook" | "profile" | "server";

interface InvestigationInterfaceProps {
  archive: ArchiveRecord[];
}

interface SearchResponse {
  records: ArchiveRecord[];
  count: number;
}

interface CuratorSource {
  id: string;
  title: string;
  date: string;
}

interface CuratorResponse {
  answer: string;
  sources: CuratorSource[];
  fallback?: boolean;
}

interface TheoryResult {
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

interface CuratorPanelProps {
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isAsking: boolean;
  error: string;
  result: CuratorResponse | null;
  askedQuestion: string;
  onSourceOpen: (id: string) => void;
}

const NOTEBOOK_KEY = "archive-09:evidence-ids";
const NOTEBOOK_EVENT = "archive-09:notebook-change";
const THEME_KEY = "archive-09:theme";
const THEME_EVENT = "archive-09:theme-change";
type Theme = "dark" | "light";
const SERVER_NOTEBOOK_SNAPSHOT = "__archive_notebook_server__";
const MAX_QUESTION_LENGTH = 1_000;
let volatileNotebookSnapshot = "[]";

const sections: { key: SectionKey; label: string; types?: ArchiveRecord["type"][] }[] = [
  { key: "home", label: "Archived home" },
  { key: "forum", label: "Forum", types: ["forum", "forum_capture"] },
  { key: "guestbook", label: "Guestbook", types: ["guestbook"] },
  { key: "profile", label: "User profile", types: ["profile"] },
  { key: "server", label: "System records", types: ["server_log", "metadata_report", "system_trace"] },
];

const theoryOptions: { id: TheoryId; title: string; description: string }[] = [
  { id: "orphaned-process", title: "The orphaned process", description: "A surviving maintenance task explains some of the mirror activity." },
  { id: "human-maintained", title: "A human maintained the mirror", description: "Someone may have retained access to the surviving copy." },
  { id: "autonomous-operator", title: "An autonomous operator", description: "The unexplained traces may point to behavior beyond ordinary maintenance." },
];

const reliabilityLabel: Record<ArchiveRecord["reliability"], string> = {
  high: "High reliability",
  medium: "Medium reliability",
  low: "Low reliability",
};

function getApiError(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = payload.error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

function subscribeToNotebook(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(NOTEBOOK_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(NOTEBOOK_EVENT, onStoreChange);
  };
}

function subscribeToTheme(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key !== THEME_KEY && event.key !== null) return;
    document.documentElement.dataset.theme = event.newValue === "light" ? "light" : "dark";
    onStoreChange();
  }
  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_EVENT, onStoreChange);
  };
}

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function getServerThemeSnapshot(): Theme {
  return "dark";
}

function getNotebookSnapshot(): string {
  try {
    return window.localStorage.getItem(NOTEBOOK_KEY) ?? "[]";
  } catch {
    return volatileNotebookSnapshot;
  }
}

function getServerNotebookSnapshot(): string {
  return SERVER_NOTEBOOK_SNAPSHOT;
}

function getSavedIds(snapshot: string, archive: ArchiveRecord[]): string[] {
  if (snapshot === SERVER_NOTEBOOK_SNAPSHOT) return [];
  try {
    const parsed: unknown = JSON.parse(snapshot);
    if (!Array.isArray(parsed)) return [];
    const knownIds = new Set(archive.map(({ id }) => id));
    return parsed.filter((id): id is string => typeof id === "string" && knownIds.has(id));
  } catch {
    return [];
  }
}

function persistSavedIds(ids: string[]): boolean {
  volatileNotebookSnapshot = JSON.stringify(ids);
  try {
    const saved = persistEvidenceIds(window.localStorage, NOTEBOOK_KEY, ids);
    window.dispatchEvent(new Event(NOTEBOOK_EVENT));
    return saved;
  } catch {
    // Keep notebook changes available for this session if browser storage is blocked.
    window.dispatchEvent(new Event(NOTEBOOK_EVENT));
    return false;
  }
}

function saveProgress(progress: PersistedGameProgress): boolean {
  try {
    const notebookSaved = persistSavedIds(progress.evidenceIds);
    const progressSaved = persistGameProgress(window.localStorage, progress);
    return notebookSaved && progressSaved;
  } catch {
    return false;
  }
}

function isTheoryResult(value: unknown): value is TheoryResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return typeof result.theoryId === "string" && ["orphaned-process", "human-maintained", "autonomous-operator"].includes(result.theoryId)
    && (result.theoryAssessment === "best-supported" || result.theoryAssessment === "plausible-not-proven" || result.theoryAssessment === "not-established")
    && (result.reasoningAssessment === "careful" || result.reasoningAssessment === "developing")
    && Array.isArray(result.supportingEvidenceIds) && result.supportingEvidenceIds.every((id) => typeof id === "string")
    && Array.isArray(result.counterEvidenceIds) && result.counterEvidenceIds.every((id) => typeof id === "string")
    && Array.isArray(result.feedback) && result.feedback.every((line) => typeof line === "string")
    && typeof result.conclusion === "string"
    && result.endingId === "partial-reveal"
    && typeof result.completedAt === "string";
}

function CuratorPanel({
  question,
  onQuestionChange,
  onSubmit,
  isAsking,
  error,
  result,
  askedQuestion,
  onSourceOpen,
}: CuratorPanelProps) {
  const questionId = "curator-question";
  const titleId = "curator-title";

  return (
    <section className="curator-panel" aria-labelledby={titleId}>
      <div className="curator-heading">
        <div className="curator-seal" aria-hidden="true">C</div>
        <div className="curator-heading-copy">
          <p className="micro-label">ARCHIVE ASSISTANT / LOCAL</p>
          <h2 id={titleId}>Ask The Curator</h2>
        </div>
      </div>
      <p className="panel-description">Ask about the recovered records. The Curator answers from retrieved evidence.</p>
      <form className="curator-form" onSubmit={onSubmit}>
        <label htmlFor={questionId}>YOUR QUESTION</label>
        <textarea
          id={questionId}
          rows={3}
          maxLength={MAX_QUESTION_LENGTH}
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder="What happened after the shutdown notice?"
          disabled={isAsking}
          aria-describedby={`${questionId}-help`}
        />
        <div className="curator-form-foot">
          <small id={`${questionId}-help`}>{question.length}/{MAX_QUESTION_LENGTH}</small>
          <button type="submit" disabled={isAsking}>
            {isAsking ? "CONSULTING…" : "ASK THE CURATOR →"}
          </button>
        </div>
      </form>
      {error && <p className="inline-error curator-error" role="alert">{error}</p>}
      {isAsking && <p className="curator-loading" role="status"><span className="loading-mark" /> Reviewing archive evidence…</p>}
      {result && (
        <div className="curator-response" aria-live="polite">
          {result.fallback && <p className="curator-fallback-note" role="status">LOCAL MODEL UNAVAILABLE / DIRECT RECORD EXCERPTS</p>}
          {askedQuestion && <p className="asked-question"><span>YOUR QUESTION</span>{askedQuestion}</p>}
          <p className="micro-label">CURATOR RESPONSE</p>
          <p className="curator-answer">{result.answer}</p>
          <div className="source-block">
              <span className="source-heading">CITED ARCHIVE RECORDS</span>
              <p className="curator-source-note">The Curator can misread a record. Open each citation to verify what it supports.</p>
            {result.sources.length === 0 ? (
              <p className="no-sources">No archive records were retrieved for this question.</p>
            ) : (
              <ul className="source-list">
                {result.sources.map((source) => (
                  <li key={source.id}>
                    <button type="button" onClick={() => onSourceOpen(source.id)}>
                      <span>{source.id}</span><strong>{source.title}</strong><time dateTime={source.date}>{source.date}</time>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="curator-footnote">LOCAL MODEL <span>·</span> EVIDENCE-LED ANSWERS</div>
    </section>
  );
}

export default function InvestigationInterface({ archive }: InvestigationInterfaceProps) {
  const [section, setSection] = useState<SectionKey>("home");
  const [activeRecordId, setActiveRecordId] = useState<string | null>(
    archive.find(({ id }) => id === "ARC-003")?.id ?? archive[0]?.id ?? null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ArchiveRecord[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const notebookSnapshot = useSyncExternalStore(
    subscribeToNotebook,
    getNotebookSnapshot,
    getServerNotebookSnapshot
  );
  const notebookReady = notebookSnapshot !== SERVER_NOTEBOOK_SNAPSHOT;
  const savedIds = getSavedIds(notebookSnapshot, archive);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [curatorError, setCuratorError] = useState("");
  const [curatorResult, setCuratorResult] = useState<CuratorResponse | null>(null);
  const [lastQuestion, setLastQuestion] = useState("");
  const [documentOpen, setDocumentOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(true);
  const [gameProgress, setGameProgress] = useState<PersistedGameProgress | null>(null);
  const [gameProgressReady, setGameProgressReady] = useState(false);
  const [progressStorageError, setProgressStorageError] = useState("");
  const [theoryId, setTheoryId] = useState<TheoryId>("orphaned-process");
  const [supportingEvidenceIds, setSupportingEvidenceIds] = useState<string[]>([]);
  const [counterEvidenceIds, setCounterEvidenceIds] = useState<string[]>([]);
  const [unresolvedQuestion, setUnresolvedQuestion] = useState("");
  const [theoryResult, setTheoryResult] = useState<TheoryResult | null>(null);
  const [theoryError, setTheoryError] = useState("");
  const [isSubmittingTheory, setIsSubmittingTheory] = useState(false);
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);
  const curatorRequestLock = useRef(false);
  const documentDialogRef = useRef<HTMLDialogElement>(null);
  const aboutDialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const aboutReturnFocusRef = useRef<HTMLElement | null>(null);

  const visibleRecords = useMemo(() => {
    if (searchResults) return searchResults;
    const activeSection = sections.find((item) => item.key === section);
    return activeSection?.types
      ? archive.filter(({ type }) => activeSection.types?.includes(type))
      : archive;
  }, [archive, searchResults, section]);

  const activeRecord = archive.find(({ id }) => id === activeRecordId) ?? null;
  const savedRecords = archive.filter(({ id }) => savedIds.includes(id));
  const activeSectionLabel = sections.find(({ key }) => key === section)?.label ?? "Archived home";

  // Client storage is an external persistence source; restore its snapshot after hydration.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const dialog = documentDialogRef.current;
    if (!dialog) return;

    if (documentOpen && activeRecord && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-document-close]")?.focus();
    } else if (!documentOpen && dialog.open) {
      dialog.close();
      if (returnFocusRef.current?.isConnected) {
        requestAnimationFrame(() => returnFocusRef.current?.focus({ preventScroll: true }));
      }
    }
  }, [activeRecord, documentOpen]);

  useEffect(() => {
    const dialog = aboutDialogRef.current;
    if (!dialog) return;

    if (aboutOpen && !dialog.open) {
      aboutReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-about-close]")?.focus();
    } else if (!aboutOpen && dialog.open) {
      dialog.close();
      if (aboutReturnFocusRef.current?.isConnected) {
        requestAnimationFrame(() => aboutReturnFocusRef.current?.focus({ preventScroll: true }));
      }
    }
  }, [aboutOpen]);

  useEffect(() => {
    let cancelled = false;
    const archiveIds = archive.map(({ id }) => id);
    const legacyEvidenceIds = getSavedIds(getNotebookSnapshot(), archive);
    let restored: PersistedGameProgress | null = null;
    let raw: string | null = null;

    try {
      raw = window.localStorage.getItem(GAME_PROGRESS_KEY);
      restored = parseGameProgress(raw, archiveIds);
      if (raw && !restored) {
        setProgressStorageError("Saved investigation data was invalid. Your evidence notebook is still available.");
        raw = null;
      }
    } catch {
      setProgressStorageError("Browser storage is unavailable. Progress will remain only for this session.");
    }

    if (!restored) restored = createEmptyGameProgress(legacyEvidenceIds);
    volatileNotebookSnapshot = JSON.stringify(restored.evidenceIds);
    try {
      window.localStorage.setItem(NOTEBOOK_KEY, volatileNotebookSnapshot);
      if (!raw && !persistGameProgress(window.localStorage, restored)) {
        setProgressStorageError("Investigation data could not be saved. Progress will remain only for this session.");
      }
    } catch {
      setProgressStorageError("Browser storage is unavailable. Progress will remain only for this session.");
    }
    window.dispatchEvent(new Event(NOTEBOOK_EVENT));

    setGameProgress(restored);
    if (restored.submission) {
      setTheoryId(restored.submission.theoryId);
      setSupportingEvidenceIds(restored.submission.supportingEvidenceIds);
      setCounterEvidenceIds(restored.submission.counterEvidenceIds);
      setUnresolvedQuestion(restored.submission.unresolvedQuestion);
    }
    setGameProgressReady(true);

    if (!restored.submission) return () => { cancelled = true; };

    setIsSubmittingTheory(true);
    void fetch("/api/theory", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        ...restored.submission,
        collectedEvidenceIds: [...new Set([
          ...restored.evidenceIds,
          ...restored.submission.supportingEvidenceIds,
          ...restored.submission.counterEvidenceIds,
        ])],
      }),
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(getApiError(payload, "Saved theory could not be restored."));
        if (typeof payload !== "object" || payload === null || !("evaluation" in payload) || !isTheoryResult(payload.evaluation)) {
          throw new Error("The saved theory returned an unexpected evaluation.");
        }
        if (cancelled) return;
        const completedAt = restored?.ending?.completedAt ?? payload.evaluation.completedAt;
        const restoredEvaluation = { ...payload.evaluation, completedAt };
        setTheoryResult(restoredEvaluation);
        const completed = { ...restored!, ending: { id: restoredEvaluation.endingId, completedAt } };
        setGameProgress(completed);
        if (!saveProgress(completed)) setProgressStorageError("The conclusion was restored for this session, but browser storage could not be updated.");
      })
      .catch((error: unknown) => {
        if (!cancelled) setTheoryError(error instanceof Error ? error.message : "Saved theory could not be restored.");
      })
      .finally(() => {
        if (!cancelled) setIsSubmittingTheory(false);
      });

    return () => { cancelled = true; };
  }, [archive]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function selectSection(nextSection: SectionKey) {
    setDocumentOpen(false);
    setSection(nextSection);
    setSearchResults(null);
    setSearchQuery("");
    setSearchError("");
    const nextTypes = sections.find(({ key }) => key === nextSection)?.types;
    const nextRecord = nextTypes ? archive.find(({ type }) => nextTypes.includes(type)) : archive[0];
    setActiveRecordId(nextRecord?.id ?? null);
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setSearchError("Enter a word or phrase to search the archive.");
      setSearchResults(null);
      return;
    }

    setSearchError("");
    setSearchResults([]);
    setIsSearching(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(getApiError(payload, "Archive search failed."));
      if (typeof payload !== "object" || payload === null || !("records" in payload)) {
        throw new Error("The archive returned an unexpected search response.");
      }

      const result = payload as SearchResponse;
      if (!Array.isArray(result.records)) throw new Error("The archive returned an invalid record list.");
      setSearchResults(result.records);
      setActiveRecordId(result.records[0]?.id ?? null);
    } catch (error) {
      setSearchResults(null);
      setSearchError(error instanceof Error ? error.message : "Archive search failed. Try again.");
    } finally {
      setIsSearching(false);
    }
  }

  function clearSearch() {
    setDocumentOpen(false);
    setSearchQuery("");
    setSearchResults(null);
    setSearchError("");
    const nextTypes = sections.find(({ key }) => key === section)?.types;
    const nextRecord = nextTypes ? archive.find(({ type }) => nextTypes.includes(type)) : archive[0];
    setActiveRecordId(nextRecord?.id ?? null);
  }

  function openRecord(id: string) {
    if (!archive.some((record) => record.id === id)) return;
    const current = document.activeElement;
    if (current instanceof HTMLElement) returnFocusRef.current = current;
    setSection("home");
    setSearchResults(null);
    setSearchQuery("");
    setSearchError("");
    setActiveRecordId(id);
    setDocumentOpen(true);
  }

  function closeDocument() {
    setDocumentOpen(false);
  }

  function handleDocumentCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    closeDocument();
  }

  function handleDocumentBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeDocument();
  }

  function toggleEvidence(recordId: string) {
    const nextIds = savedIds.includes(recordId)
      ? savedIds.filter((id) => id !== recordId)
      : [...savedIds, recordId];
    const nextProgress = { ...(gameProgress ?? createEmptyGameProgress()), evidenceIds: nextIds };
    setGameProgress(nextProgress);
    if (!saveProgress(nextProgress)) setProgressStorageError("Evidence changed in this session, but browser storage could not save it.");
    else setProgressStorageError("");
  }

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(THEME_KEY, nextTheme);
    } catch {
      // The selected theme remains active for this page view if storage is unavailable.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  async function askCurator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = question.trim();
    setCuratorError("");
    if (!prompt) {
      setCuratorError("Write a question before consulting The Curator.");
      return;
    }
    if (prompt.length > MAX_QUESTION_LENGTH || curatorRequestLock.current) return;

    curatorRequestLock.current = true;
    setIsAsking(true);
    setLastQuestion(prompt);
    setCuratorResult(null);
    try {
      const response = await fetch("/api/curator", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ question: prompt }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(getApiError(payload, "The Curator could not answer right now."));
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("answer" in payload) ||
        typeof payload.answer !== "string" ||
        !("sources" in payload) ||
        !Array.isArray(payload.sources)
      ) {
        throw new Error("The Curator returned an unexpected response.");
      }
      setCuratorResult(payload as CuratorResponse);
    } catch (error) {
      setCuratorError(error instanceof Error ? error.message : "The Curator could not answer right now.");
    } finally {
      curatorRequestLock.current = false;
      setIsAsking(false);
    }
  }

  async function submitTheory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTheoryError("");
    if (isSubmittingTheory || !gameProgressReady) return;
    if (supportingEvidenceIds.length < 2) {
      setTheoryError("Choose at least two saved records that support your explanation.");
      return;
    }
    if (counterEvidenceIds.length < 1) {
      setTheoryError("Choose at least one saved record that complicates your explanation.");
      return;
    }
    if ([...supportingEvidenceIds, ...counterEvidenceIds].some((id) => !savedIds.includes(id))) {
      setTheoryError("Only records currently saved in your evidence notebook can be submitted.");
      return;
    }

    const submission: TheorySubmission = {
      theoryId,
      supportingEvidenceIds,
      counterEvidenceIds,
      unresolvedQuestion: unresolvedQuestion.trim(),
    };
    setIsSubmittingTheory(true);
    setTheoryResult(null);
    try {
      const response = await fetch("/api/theory", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...submission, collectedEvidenceIds: savedIds }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(getApiError(payload, "The theory could not be evaluated."));
      if (typeof payload !== "object" || payload === null || !("evaluation" in payload) || !isTheoryResult(payload.evaluation)) {
        throw new Error("The investigation returned an unexpected evaluation.");
      }

      const result = payload.evaluation;
      const completed: PersistedGameProgress = {
        version: 1,
        evidenceIds: savedIds,
        submission,
        ending: { id: result.endingId, completedAt: result.completedAt },
      };
      setTheoryResult(result);
      setGameProgress(completed);
      if (!saveProgress(completed)) setProgressStorageError("Your conclusion is available for this session, but browser storage could not save it.");
    } catch (error) {
      setTheoryError(error instanceof Error ? error.message : "The theory could not be evaluated.");
    } finally {
      setIsSubmittingTheory(false);
    }
  }

  function toggleTheoryEvidence(recordId: string, role: "support" | "counter") {
    if (role === "support") {
      setSupportingEvidenceIds((current) => current.includes(recordId) ? current.filter((id) => id !== recordId) : [...current, recordId]);
      setCounterEvidenceIds((current) => current.filter((id) => id !== recordId));
    } else {
      setCounterEvidenceIds((current) => current.includes(recordId) ? current.filter((id) => id !== recordId) : [...current, recordId]);
      setSupportingEvidenceIds((current) => current.filter((id) => id !== recordId));
    }
  }

  function reviseTheory() {
    const nextProgress = { ...(gameProgress ?? createEmptyGameProgress(savedIds)), evidenceIds: savedIds, submission: null, ending: null };
    setTheoryResult(null);
    setTheoryError("");
    setGameProgress(nextProgress);
    if (!saveProgress(nextProgress)) setProgressStorageError("The previous conclusion remains cleared only for this session; browser storage could not be updated.");
    else setProgressStorageError("");
  }

  return (
    <main className="archive-page atmosphere-on">
      <header className="case-masthead">
        <div className="masthead-mark" aria-hidden="true">09</div>
        <div className="masthead-copy">
          <p className="kicker">A DIGITAL MYSTERY / ARCHIVE ACCESS TERMINAL</p>
          <h1>ARCHIVE <span>09</span></h1>
          <p className="masthead-subtitle">The Internet That Forgot You</p>
        </div>
        <div className="archive-status"><span className="status-light" /> RECOVERED COLLECTION <span className="status-divider">/</span> READ ONLY</div>
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          aria-pressed={theme === "dark"}
        >
          <span aria-hidden="true">{theme === "dark" ? "☼" : "◐"}</span>
          {theme === "dark" ? "LIGHT MODE" : "DARK MODE"}
        </button>
        <button className="about-toggle" type="button" onClick={() => setAboutOpen(true)} aria-haspopup="dialog">
          ABOUT / HOW TO INVESTIGATE
        </button>
      </header>

      <section className="incident-brief" aria-labelledby="incident-title">
        <div className="incident-index"><span>CASE FILE</span><strong>01</strong><span>OPEN</span></div>
        <div className="incident-copy">
          <p className="kicker">THE OCTOBER 16 INCIDENT</p>
          <h2 id="incident-title">The dates do not agree.</h2>
          <p>Investigate the conflicting records. Follow the trail, compare sources, and collect evidence in your notebook.</p>
          <a className="begin-investigation" href="#archive-records">Begin with the recovered records <span aria-hidden="true">→</span></a>
        </div>
        <div className="incident-date"><span>WINDOW UNDER REVIEW</span><strong>12 — 16 OCT 2009</strong></div>
        <span className="incident-ghost" aria-hidden="true"><i /><i /></span>
      </section>

      <section className="browser-window" aria-label="Fictional archived website browser">
        <div className="browser-chrome">
          <div className="browser-lights" aria-hidden="true"><span /><span /><span /></div>
          <div className="browser-caption"><strong>OCTOBER ONLINE — ARCHIVE VIEWER</strong><span>·</span> SESSION 09-1016</div>
          <div className="connection-state"><span className="connection-light" /> <span className="connection-copy">SNAPSHOT LOADED</span></div>
        </div>
        <div className="legacy-toolbar">
          <div className="legacy-menu" aria-hidden="true"><span>File</span><span>Edit</span><span>View</span><span>Favorites</span><span>Tools</span><span>Help</span></div>
          <div className="legacy-actions" aria-hidden="true">
            <span><b>←</b> Back</span><span><b>→</b> Forward</span><span><b>×</b> Stop</span><span><b>↻</b> Refresh</span><span><b>⌂</b> Home</span><span><b>⌕</b> Search</span>
          </div>
          <span className="toolbar-archive-label">ARCHIVE VIEW / READ ONLY</span>
        </div>
        <div className="address-row">
          <span className="address-label">LOCATION</span>
          <div className="address-field"><span aria-hidden="true">⌁</span> http://october-16.net/archived/</div>
          <span className="address-lock">LOCAL COPY</span>
        </div>

        <div className="site-banner">
          <div className="site-wordmark"><span className="site-emblem">O</span><div><strong>OCTOBER<br />ONLINE</strong><small>community pages · est. 1998</small></div></div>
          <div className="site-banner-note"><span>LOCAL RECOVERY COPY</span><strong>READ ONLY / {archive.length.toString().padStart(2, "0")} FILES</strong></div>
        </div>

        <div className="investigation-layout">
          <aside className="index-rail">
            <div className="rail-heading">
              <span>DIRECTORY</span><span>{archive.length.toString().padStart(2, "0")} FILES</span>
              <button
                className="directory-toggle"
                type="button"
                aria-expanded={directoryOpen}
                aria-controls="archive-section-nav"
                onClick={() => setDirectoryOpen((open) => !open)}
              >
                {directoryOpen ? "HIDE" : "SHOW"} INDEX
              </button>
            </div>
            <nav id="archive-section-nav" className="archive-nav" aria-label="Archive sections" hidden={!directoryOpen}>
              {sections.map((item, index) => {
                const count = item.types ? archive.filter(({ type }) => item.types?.includes(type)).length : archive.length;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`nav-item${section === item.key && !searchResults ? " is-active" : ""}`}
                    onClick={() => selectSection(item.key)}
                    aria-current={section === item.key && !searchResults ? "page" : undefined}
                  >
                    <span className="nav-number">0{index + 1}</span>
                    <span className="nav-label">{item.label}</span>
                    <span className="nav-count">{count.toString().padStart(2, "0")}</span>
                  </button>
                );
              })}
            </nav>
            <div className="rail-note">
              <span className="note-mark">i</span>
              <p>Pages reconstructed from surviving records. Some details may be incomplete.</p>
            </div>
            <div className="reliability-key">
              <p className="micro-label">SOURCE RELIABILITY</p>
              <span><i className="reliability-dot high" /> High</span>
              <span><i className="reliability-dot medium" /> Medium</span>
              <span><i className="reliability-dot low" /> Low</span>
            </div>
          </aside>

          <section className="archive-content" id="archive-records" aria-label="Archive records">
            <div className="content-topline">
              <div>
                <p className="micro-label">ARCHIVED FILES <span>/</span> {searchResults ? "SEARCH RESULTS" : activeSectionLabel.toUpperCase()}</p>
                <h2>{searchResults ? `Matches for “${searchQuery.trim()}”` : activeSectionLabel}</h2>
              </div>
              <span className="record-count">{isSearching ? "SEARCHING…" : `${visibleRecords.length.toString().padStart(2, "0")} RECORD${visibleRecords.length === 1 ? "" : "S"}`}</span>
            </div>

            <form className="archive-search" onSubmit={submitSearch} role="search">
              <label className="visually-hidden" htmlFor="archive-search">Search archive records</label>
              <span aria-hidden="true" className="search-glyph">⌕</span>
              <input
                id="archive-search"
                type="search"
                placeholder="Search names, dates, records…"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                aria-describedby={searchError ? "search-message" : undefined}
              />
              {searchResults && <button className="clear-search" type="button" onClick={clearSearch}>CLEAR</button>}
              <button className="search-submit" type="submit" disabled={isSearching}>{isSearching ? "…" : "SEARCH"}</button>
            </form>
            {searchError && <p id="search-message" className="inline-error" role="alert">{searchError}</p>}

            {isSearching ? (
              <div className="empty-state" role="status"><span className="loading-mark" /> Searching the recovered index…</div>
            ) : visibleRecords.length === 0 ? (
              <div className="empty-state"><span className="empty-symbol">∅</span><strong>No records found</strong><p>Try another term or return to the archived home page.</p>{searchResults && <button type="button" className="text-button" onClick={clearSearch}>Show all records</button>}</div>
            ) : (
              <div className="record-list" aria-label="Matching archive records">
                <div className="record-list-heading" aria-hidden="true"><span>DOCUMENT / CONTRIBUTOR</span><span>DATE / RELIABILITY</span></div>
                {visibleRecords.map((record, index) => (
                  <button
                    type="button"
                    key={record.id}
                    className={`record-row${record.id === activeRecordId ? " is-selected" : ""}`}
                    data-reliability={record.reliability}
                    onClick={() => openRecord(record.id)}
                    aria-pressed={record.id === activeRecordId}
                    aria-haspopup="dialog"
                  >
                    <span className="record-order">{String(index + 1).padStart(2, "0")}</span>
                    <span className="record-row-main">
                      <span className="record-type">{record.type.replaceAll("_", " ")}</span>
                      <strong>{record.title}</strong>
                      <span className="record-row-meta">{record.id} <span>·</span> {record.author}</span>
                    </span>
                    <span className="record-row-side">
                      <time dateTime={record.date}>{record.date}</time>
                      <span className={`record-reliability ${record.reliability}`}>
                        <i className={`reliability-dot ${record.reliability}`} />
                        <span>{record.reliability}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

          </section>

          <aside id="investigation-tools" className="utility-rail" aria-label="Evidence notebook and Curator">
            <section className="notebook-panel" aria-labelledby="notebook-title">
              <div className="panel-heading">
                <div><p className="micro-label">PLAYER TOOL / 01</p><h2 id="notebook-title">Evidence notebook</h2></div>
                <span className="notebook-count">{savedRecords.length.toString().padStart(2, "0")}</span>
              </div>
              <p className="panel-description">Keep the records you want to compare. Nothing is saved unless you choose it.</p>
              {!notebookReady ? (
                <p className="notebook-status">Restoring your notebook…</p>
              ) : savedRecords.length === 0 ? (
                <div className="notebook-empty"><span>＋</span><p>Your evidence list is empty.</p><small>Open a record and save it to begin.</small></div>
              ) : (
                <ul className="evidence-list">
                  {savedRecords.map((record) => (
                    <li key={record.id}>
                      <button type="button" className="evidence-link" onClick={() => openRecord(record.id)}><span>{record.id}</span><strong>{record.title}</strong></button>
                      <button type="button" className="remove-evidence" onClick={() => toggleEvidence(record.id)} aria-label={`Remove ${record.title} from evidence notebook`}>×</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="notebook-footer"><span>LOCAL NOTEBOOK</span><span>{!notebookReady ? "RESTORING" : progressStorageError ? "SESSION ONLY" : "SAVED"}</span></div>
            </section>

            <CuratorPanel
              question={question}
              onQuestionChange={setQuestion}
              onSubmit={askCurator}
              isAsking={isAsking}
              error={curatorError}
              result={curatorResult}
              askedQuestion={lastQuestion}
              onSourceOpen={openRecord}
            />
          </aside>
        </div>
        <footer className="browser-footer"><span>OCTOBER ONLINE ARCHIVE</span><span>RECONSTRUCTED FROM {archive.length} RECOVERED RECORDS</span><span>© 2009 / COPY PRESERVED</span></footer>
      </section>
      <section className="theory-panel" id="submit-theory" aria-labelledby="theory-title">
        <header className="theory-panel-heading">
          <div>
            <p className="micro-label">INVESTIGATION / FINAL STAGE</p>
            <h2 id="theory-title">Submit your theory</h2>
          </div>
          <span className="theory-stage-mark">{theoryResult ? "CASE REVIEWED" : "EVIDENCE-LED"}</span>
        </header>

        {progressStorageError && <p className="inline-error theory-storage-note" role="status">{progressStorageError}</p>}
        {theoryError && <p className="inline-error" role="alert">{theoryError}</p>}

        {isSubmittingTheory && gameProgress?.submission ? (
          <p className="theory-loading" role="status"><span className="loading-mark" /> Restoring your completed investigation…</p>
        ) : theoryResult ? (
          <div className="theory-result" aria-live="polite">
            <div className="theory-result-status">
              <span className="micro-label">PARTIAL REVEAL / {theoryResult.endingId.toUpperCase()}</span>
              <span className={`theory-assessment ${theoryResult.theoryAssessment}`}>{theoryResult.theoryAssessment.replaceAll("-", " ").toUpperCase()}</span>
            </div>
            <p className="theory-reasoning-label">YOUR THEORY: {theoryOptions.find((option) => option.id === theoryResult.theoryId)?.title.toUpperCase()}</p>
            <p className="theory-reasoning-label">REASONING: {theoryResult.reasoningAssessment.toUpperCase()}</p>
            <ul className="theory-feedback">
              {theoryResult.feedback.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
            </ul>
            <section className="theory-conclusion" aria-labelledby="conclusion-title">
              <p className="micro-label">CANONICAL FINDING</p>
              <h3 id="conclusion-title">The Process That Remained</h3>
              <p>{theoryResult.conclusion}</p>
              <p className="theory-open-question"><strong>Still unresolved:</strong> {gameProgress?.submission?.unresolvedQuestion || "Who, or what, originated the remaining anomalies?"}</p>
            </section>
            <div className="theory-cited-records">
              <span className="source-heading">YOUR SUBMITTED EVIDENCE</span>
              <div>
                {[...new Set([...theoryResult.supportingEvidenceIds, ...theoryResult.counterEvidenceIds])].map((id) => {
                  const record = archive.find((item) => item.id === id);
                  return record ? <button type="button" key={id} onClick={() => openRecord(id)}><span>{id}</span> {record.title}</button> : null;
                })}
              </div>
            </div>
            <button className="theory-revise" type="button" onClick={reviseTheory}>REVISE THEORY</button>
          </div>
        ) : !gameProgressReady ? (
          <p className="theory-loading" role="status"><span className="loading-mark" /> Restoring investigation progress…</p>
        ) : (
          <form className="theory-form" onSubmit={submitTheory}>
            <fieldset className="theory-options">
              <legend>Which explanation best fits the records?</legend>
              {theoryOptions.map((option) => (
                <label className={`theory-option${theoryId === option.id ? " is-selected" : ""}`} key={option.id}>
                  <input type="radio" name="theory-id" value={option.id} checked={theoryId === option.id} onChange={() => setTheoryId(option.id)} />
                  <span><strong>{option.title}</strong><small>{option.description}</small></span>
                </label>
              ))}
            </fieldset>

            <div className="theory-evidence-head">
              <div><h3>Connect the evidence</h3><p>Save records in your notebook first, then mark how each record relates to your theory.</p></div>
              <span>{savedIds.length.toString().padStart(2, "0")} / {archive.length.toString().padStart(2, "0")} COLLECTED</span>
            </div>
            {savedIds.length === 0 ? (
              <p className="theory-no-evidence">Your notebook is empty. Open archive records and choose <strong>Save as Evidence</strong> to continue.</p>
            ) : (
              <div className="theory-evidence-list" role="group" aria-label="Classify saved evidence">
                <div className="theory-evidence-columns" aria-hidden="true"><span>RECOVERED RECORD</span><span>SUPPORTS</span><span>COMPLICATES</span></div>
                {archive.filter(({ id }) => savedIds.includes(id)).map((record) => (
                  <div className="theory-evidence-row" key={record.id}>
                    <button type="button" className="theory-evidence-open" onClick={() => openRecord(record.id)}><span>{record.id}</span><strong>{record.title}</strong></button>
                    <label><span className="visually-hidden">{record.id} supports the theory</span><input type="checkbox" checked={supportingEvidenceIds.includes(record.id)} onChange={() => toggleTheoryEvidence(record.id, "support")} /></label>
                    <label><span className="visually-hidden">{record.id} complicates the theory</span><input type="checkbox" checked={counterEvidenceIds.includes(record.id)} onChange={() => toggleTheoryEvidence(record.id, "counter")} /></label>
                  </div>
                ))}
              </div>
            )}

            <label className="theory-unresolved-label" htmlFor="unresolved-question">WHAT REMAINS UNEXPLAINED? <span>OPTIONAL</span></label>
            <textarea id="unresolved-question" maxLength={300} value={unresolvedQuestion} onChange={(event) => setUnresolvedQuestion(event.target.value)} placeholder="Which clue still has more than one possible explanation?" />
            <div className="theory-form-footer">
              <p>Choose at least two supporting records and one that complicates your theory. The evaluation considers evidence and uncertainty, not just your selected explanation.</p>
              <button type="submit" disabled={isSubmittingTheory || !gameProgressReady}>{isSubmittingTheory ? "REVIEWING EVIDENCE…" : "SUBMIT THEORY →"}</button>
            </div>
          </form>
        )}
      </section>
      {activeRecord && (
        <dialog
          ref={documentDialogRef}
          className={`document-dialog${activeRecord.reliability === "low" ? " is-anomalous" : ""}`}
          aria-labelledby="document-title"
          aria-describedby="document-content"
          data-reliability={activeRecord.reliability}
          onCancel={handleDocumentCancel}
          onClick={handleDocumentBackdrop}
        >
          <article className="document-sheet">
            <header className="document-window-bar">
              <div><span className="document-stamp">RECOVERED DOCUMENT</span><span className="document-id">{activeRecord.id}</span></div>
              <button className="document-close" data-document-close type="button" onClick={closeDocument} aria-label="Close document viewer">×</button>
            </header>
            <div className="document-body">
              <div className="document-title-row">
                <div>
                  <p className="micro-label">{activeRecord.type.replaceAll("_", " ")} / {activeRecord.date}</p>
                  <h2 id="document-title">{activeRecord.title}</h2>
                </div>
                <span className={`document-reliability ${activeRecord.reliability}`}>
                  <i className={`reliability-dot ${activeRecord.reliability}`} />
                  {reliabilityLabel[activeRecord.reliability]}
                </span>
              </div>
              <div className="document-meta">
                <span><small>RECORD ID</small><strong>{activeRecord.id}</strong></span>
                <span><small>DATE</small><time dateTime={activeRecord.date}>{activeRecord.date}</time></span>
                <span><small>AUTHOR</small><strong>{activeRecord.author}</strong></span>
                <span><small>TYPE</small><strong>{activeRecord.type.replaceAll("_", " ")}</strong></span>
              </div>
              <blockquote className="document-content" id="document-content">{activeRecord.content}</blockquote>
              <div className="document-tags" aria-label="Record tags">
                <span className="document-tags-label">INDEX TERMS</span>
                {activeRecord.tags.map((tag) => <span className="document-tag" key={tag}>#{tag}</span>)}
              </div>
              <footer className="document-actions">
                <span className="document-note">CONTENT PRESERVED AS FOUND</span>
                <button
                  type="button"
                  className={`collect-button${savedIds.includes(activeRecord.id) ? " is-saved" : ""}`}
                  onClick={() => toggleEvidence(activeRecord.id)}
                  disabled={!notebookReady || !gameProgressReady}
                  aria-pressed={savedIds.includes(activeRecord.id)}
                >
                  <span aria-hidden="true">{savedIds.includes(activeRecord.id) ? "✓" : "+"}</span>
                  {savedIds.includes(activeRecord.id) ? "SAVED AS EVIDENCE" : "SAVE AS EVIDENCE"}
                </button>
              </footer>
            </div>
          </article>
        </dialog>
      )}
      <dialog
        ref={aboutDialogRef}
        className="about-dialog"
        aria-labelledby="about-title"
        onCancel={(event) => { event.preventDefault(); setAboutOpen(false); }}
        onClick={(event) => { if (event.target === event.currentTarget) setAboutOpen(false); }}
      >
        <article className="about-sheet">
          <header className="about-window-bar">
            <div><span className="about-window-stamp">PLAYER FIELD GUIDE</span><span className="about-window-id">ARCHIVE 09 / 01</span></div>
            <button className="about-close" data-about-close type="button" onClick={() => setAboutOpen(false)} aria-label="Close investigation guide">×</button>
          </header>
          <div className="about-body">
            <p className="about-kicker">ARCHIVE 09 — THE INTERNET THAT FORGOT YOU</p>
            <h2 id="about-title">How to investigate</h2>
            <p className="about-intro">“Some websites disappear. Some records survive. Not every surviving record tells the truth.”</p>
            <p>You are investigating the October 16 Incident through fragments recovered from October Online. Connect evidence, examine contradictions, and build a theory supported by the surviving records.</p>
            <ol className="guide-steps">
              <li><span>01</span><div><h3>Explore the archive</h3><p>Browse archived pages, forum captures, guestbook entries, profiles, metadata reports, server logs, and system traces. Search by title, date, author, type, ID, or tag.</p></div></li>
              <li><span>02</span><div><h3>Inspect suspicious records</h3><p>Open a record to examine its content, metadata, dates, author, and reliability where available. Look for unexpected activity and discrepancies.</p></div></li>
              <li><span>03</span><div><h3>Collect evidence</h3><p>Use <strong>Save as Evidence</strong> in a record to add it to your notebook. Keep its archive ID so you can revisit and compare the source.</p></div></li>
              <li><span>04</span><div><h3>Connect the clues</h3><p>Compare records instead of reading each alone. A forum post may describe activity while a server log records a request; neither fact explains the whole incident by itself.</p></div></li>
              <li><span>05</span><div><h3>Question The Curator</h3><p>Ask specific questions about records and contradictions. Its local-model responses cite retrieved records, but check each claim against those sources.</p></div></li>
              <li><span>06</span><div><h3>Form your theory</h3><p>Use the Submit your theory panel below the archive to choose an explanation, connect supporting and complicating records, and identify what remains unknown.</p></div></li>
            </ol>
            <section className="investigation-rules" aria-labelledby="rules-title">
              <h3 id="rules-title">Keep in mind</h3>
              <ul>
                <li>A record is evidence, not automatically the truth.</li>
                <li>Dates and timestamps may be disputed.</li>
                <li>A successful server request does not prove the original site remained online.</li>
                <li>The Curator can help interpret records; verify its claims against the cited sources.</li>
                <li>Missing evidence and uncertainty are part of the investigation.</li>
              </ul>
            </section>
            <p className="guide-signoff">Read the records. Compare the evidence. Question the dates.</p>
          </div>
        </article>
      </dialog>
      <footer className="page-footer"><span>ARCHIVE 09</span><span>INVESTIGATION INTERFACE / PHASE 03</span><span>PROGRESS IS SAVED IN THIS BROWSER</span></footer>
    </main>
  );
}
