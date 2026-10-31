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
import type { ArchiveRecord } from "@/lib/retrieval";

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
}

interface CuratorPanelProps {
  variant: "inline" | "floating";
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isAsking: boolean;
  error: string;
  result: CuratorResponse | null;
  askedQuestion: string;
  onSourceOpen: (id: string) => void;
  onClose?: () => void;
}

const NOTEBOOK_KEY = "archive-09:evidence-ids";
const NOTEBOOK_EVENT = "archive-09:notebook-change";
const THEME_KEY = "archive-09:theme";
const THEME_EVENT = "archive-09:theme-change";
type Theme = "dark" | "light";
const SERVER_NOTEBOOK_SNAPSHOT = "__archive_notebook_server__";
const MAX_QUESTION_LENGTH = 1_000;
let volatileNotebookSnapshot = "[]";

const sections: { key: SectionKey; label: string; type?: string }[] = [
  { key: "home", label: "Archived home" },
  { key: "forum", label: "Forum", type: "forum_post" },
  { key: "guestbook", label: "Guestbook", type: "guestbook_entry" },
  { key: "profile", label: "User profile", type: "user_profile" },
  { key: "server", label: "Server log", type: "server_log" },
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

function persistSavedIds(ids: string[]) {
  volatileNotebookSnapshot = JSON.stringify(ids);
  try {
    window.localStorage.setItem(NOTEBOOK_KEY, volatileNotebookSnapshot);
  } catch {
    // Keep notebook changes available for this session if browser storage is blocked.
  }
  window.dispatchEvent(new Event(NOTEBOOK_EVENT));
}

function CuratorPanel({
  variant,
  question,
  onQuestionChange,
  onSubmit,
  isAsking,
  error,
  result,
  askedQuestion,
  onSourceOpen,
  onClose,
}: CuratorPanelProps) {
  const questionId = `${variant}-curator-question`;
  const titleId = `${variant}-curator-title`;

  return (
    <section className={`curator-panel${variant === "floating" ? " curator-panel-floating" : ""}`} aria-labelledby={titleId}>
      <div className="curator-heading">
        <div className="curator-seal" aria-hidden="true">C</div>
        <div className="curator-heading-copy">
          <p className="micro-label">ARCHIVE ASSISTANT / LOCAL</p>
          <h2 id={titleId}>Ask The Curator</h2>
        </div>
        {onClose && <button className="curator-close" type="button" onClick={onClose} aria-label="Close Curator panel">×</button>}
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
          autoFocus={variant === "floating"}
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
          {askedQuestion && <p className="asked-question"><span>YOUR QUESTION</span>{askedQuestion}</p>}
          <p className="micro-label">CURATOR RESPONSE</p>
          <p className="curator-answer">{result.answer}</p>
          <div className="source-block">
            <span className="source-heading">SUPPORTING RECORDS</span>
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
  const [activeRecordId, setActiveRecordId] = useState<string | null>(archive[0]?.id ?? null);
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
  const [floatingCuratorOpen, setFloatingCuratorOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(true);
  const [atmosphereEnabled, setAtmosphereEnabled] = useState(true);
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);
  const curatorRequestLock = useRef(false);
  const documentDialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const visibleRecords = useMemo(() => {
    if (searchResults) return searchResults;
    const activeSection = sections.find((item) => item.key === section);
    return activeSection?.type
      ? archive.filter(({ type }) => type === activeSection.type)
      : archive;
  }, [archive, searchResults, section]);

  const activeRecord = archive.find(({ id }) => id === activeRecordId) ?? null;
  const savedRecords = archive.filter(({ id }) => savedIds.includes(id));
  const activeSectionLabel = sections.find(({ key }) => key === section)?.label ?? "Archived home";

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
    if (!floatingCuratorOpen || documentOpen) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setFloatingCuratorOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [documentOpen, floatingCuratorOpen]);

  function selectSection(nextSection: SectionKey) {
    setDocumentOpen(false);
    setSection(nextSection);
    setSearchResults(null);
    setSearchQuery("");
    setSearchError("");
    const nextType = sections.find(({ key }) => key === nextSection)?.type;
    const nextRecord = nextType ? archive.find(({ type }) => type === nextType) : archive[0];
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
    const nextType = sections.find(({ key }) => key === section)?.type;
    const nextRecord = nextType ? archive.find(({ type }) => type === nextType) : archive[0];
    setActiveRecordId(nextRecord?.id ?? null);
  }

  function openRecord(id: string) {
    if (!archive.some((record) => record.id === id)) return;
    const current = document.activeElement;
    if (current instanceof HTMLElement) {
      const isFloatingCuratorSource = current.closest(".floating-curator-popover");
      returnFocusRef.current = isFloatingCuratorSource
        ? document.querySelector<HTMLElement>(".curator-launcher")
        : current;
    }
    setSection("home");
    setSearchResults(null);
    setSearchQuery("");
    setSearchError("");
    setActiveRecordId(id);
    setDocumentOpen(true);
    setFloatingCuratorOpen(false);
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
    persistSavedIds(nextIds);
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

  return (
    <main className={`archive-page${atmosphereEnabled ? " atmosphere-on" : " atmosphere-off"}`}>
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
      </section>

      <section className="browser-window" aria-label="Fictional archived website browser">
        <div className="browser-chrome">
          <div className="browser-lights" aria-hidden="true"><span /><span /><span /></div>
          <div className="browser-caption"><strong>OCTOBER ONLINE — ARCHIVE VIEWER</strong><span>·</span> SESSION 09-1016</div>
          <div className="connection-state">
            <span className="connection-light" /> <span className="connection-copy">SNAPSHOT LOADED</span>
            <button
              className="atmosphere-toggle"
              type="button"
              aria-pressed={atmosphereEnabled}
              onClick={() => setAtmosphereEnabled((enabled) => !enabled)}
              title="Toggle subtle archive signal effects"
            >
              FX {atmosphereEnabled ? "ON" : "OFF"}
            </button>
          </div>
        </div>
        <div className="legacy-toolbar">
          <div className="legacy-menu" aria-hidden="true"><span>File</span><span>Edit</span><span>View</span><span>Favorites</span><span>Tools</span><span>Help</span></div>
          <div className="legacy-actions" aria-hidden="true">
            <span><b>←</b> Back</span><span><b>→</b> Forward</span><span><b>×</b> Stop</span><span><b>↻</b> Refresh</span><span><b>⌂</b> Home</span><span><b>⌕</b> Search</span>
          </div>
          <button
            className="tool-drawer-toggle"
            type="button"
            aria-expanded={toolsOpen}
            aria-controls="investigation-tools"
            onClick={() => setToolsOpen((open) => !open)}
          >
            <span aria-hidden="true">▤</span> FIELD TOOLS <b>{savedRecords.length.toString().padStart(2, "0")}</b>
          </button>
        </div>
        <div className="address-row">
          <span className="address-label">LOCATION</span>
          <div className="address-field"><span aria-hidden="true">⌁</span> http://october-16.net/archived/</div>
          <span className="address-lock">LOCAL COPY</span>
        </div>

        <div className="site-banner">
          <div className="site-wordmark"><span className="site-emblem">O</span><div><strong>OCTOBER<br />ONLINE</strong><small>community pages · est. 1998</small></div></div>
          <div className="site-banner-note"><span>LOCAL RECOVERY COPY</span><strong>READ ONLY / 05 FILES</strong></div>
        </div>

        <div className="investigation-layout">
          <aside className="index-rail">
            <div className="rail-heading">
              <span>DIRECTORY</span><span>05 FILES</span>
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
                const count = item.type ? archive.filter(({ type }) => type === item.type).length : archive.length;
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

          <aside id="investigation-tools" className="utility-rail" aria-label="Investigation tools" hidden={!toolsOpen}>
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
              <div className="notebook-footer"><span>LOCAL NOTEBOOK</span><span>{notebookReady ? "AUTOSAVED" : "LOADING"}</span></div>
            </section>

            <CuratorPanel
              variant="inline"
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
        <footer className="browser-footer"><span>OCTOBER ONLINE ARCHIVE</span><span>RECONSTRUCTED FROM FIVE RECOVERED RECORDS</span><span>© 2009 / COPY PRESERVED</span></footer>
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
                  disabled={!notebookReady}
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
      <footer className="page-footer"><span>ARCHIVE 09</span><span>INVESTIGATION INTERFACE / PHASE 03</span><span>PROGRESS IS SAVED IN THIS BROWSER</span></footer>
      <div className="floating-curator">
        {floatingCuratorOpen && (
          <div className="floating-curator-popover" id="floating-curator-panel" role="dialog" aria-labelledby="floating-curator-title">
            <CuratorPanel
              variant="floating"
              question={question}
              onQuestionChange={setQuestion}
              onSubmit={askCurator}
              isAsking={isAsking}
              error={curatorError}
              result={curatorResult}
              askedQuestion={lastQuestion}
              onSourceOpen={openRecord}
              onClose={() => setFloatingCuratorOpen(false)}
            />
          </div>
        )}
        <button
          className="curator-launcher"
          type="button"
          aria-label={floatingCuratorOpen ? "Close The Curator" : "Open The Curator"}
          aria-expanded={floatingCuratorOpen}
          aria-controls="floating-curator-panel"
          aria-haspopup="dialog"
          onClick={() => setFloatingCuratorOpen((open) => !open)}
        >
          <span className="launcher-bot" aria-hidden="true">
            <span className="launcher-bot-antenna" />
            <span className="launcher-bot-head"><i /><i /></span>
          </span>
          <span className="launcher-label">THE CURATOR</span>
          <span className="launcher-state">LOCAL / READY</span>
        </button>
      </div>
    </main>
  );
}
