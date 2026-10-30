"use client";

import { useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
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

const NOTEBOOK_KEY = "archive-09:evidence-ids";
const NOTEBOOK_EVENT = "archive-09:notebook-change";
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
  const curatorRequestLock = useRef(false);
  const detailRef = useRef<HTMLElement>(null);

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

  function selectSection(nextSection: SectionKey) {
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
    setSearchQuery("");
    setSearchResults(null);
    setSearchError("");
    const nextType = sections.find(({ key }) => key === section)?.type;
    const nextRecord = nextType ? archive.find(({ type }) => type === nextType) : archive[0];
    setActiveRecordId(nextRecord?.id ?? null);
  }

  function openRecord(id: string) {
    if (!archive.some((record) => record.id === id)) return;
    setSection("home");
    setSearchResults(null);
    setSearchQuery("");
    setSearchError("");
    setActiveRecordId(id);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  function toggleEvidence(recordId: string) {
    const nextIds = savedIds.includes(recordId)
      ? savedIds.filter((id) => id !== recordId)
      : [...savedIds, recordId];
    persistSavedIds(nextIds);
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
    <main className="archive-page">
      <header className="case-masthead">
        <div className="masthead-mark" aria-hidden="true">09</div>
        <div className="masthead-copy">
          <p className="kicker">A DIGITAL MYSTERY / ARCHIVE ACCESS TERMINAL</p>
          <h1>ARCHIVE <span>09</span></h1>
          <p className="masthead-subtitle">The Internet That Forgot You</p>
        </div>
        <div className="archive-status"><span className="status-light" /> RECOVERED COLLECTION <span className="status-divider">/</span> READ ONLY</div>
      </header>

      <section className="incident-brief" aria-labelledby="incident-title">
        <div className="incident-index"><span>CASE FILE</span><strong>01</strong><span>OPEN</span></div>
        <div className="incident-copy">
          <p className="kicker">THE OCTOBER 16 INCIDENT</p>
          <h2 id="incident-title">The dates do not agree.</h2>
          <p>Investigate the conflicting records. Follow the trail, compare sources, and collect evidence in your notebook.</p>
        </div>
        <div className="incident-date"><span>WINDOW UNDER REVIEW</span><strong>12 — 16 OCT 2009</strong></div>
      </section>

      <section className="browser-window" aria-label="Fictional archived website browser">
        <div className="browser-chrome">
          <div className="browser-lights" aria-hidden="true"><span /><span /><span /></div>
          <div className="browser-caption">ARCHIVE VIEWER <span>·</span> SESSION 09-1016</div>
          <div className="connection-state"><span /> SNAPSHOT LOADED</div>
        </div>
        <div className="address-row">
          <span className="address-label">LOCATION</span>
          <div className="address-field"><span aria-hidden="true">⌁</span> http://october-16.net/archived/</div>
          <span className="address-lock">LOCAL COPY</span>
        </div>

        <div className="site-banner">
          <div className="site-wordmark"><span className="site-emblem">O</span><div><strong>OCTOBER<br />ONLINE</strong><small>community pages · est. 1998</small></div></div>
          <div className="site-banner-note"><span>LAST RECOVERED PING</span><strong>2009.10.16 / 23:41:08</strong></div>
        </div>

        <div className="investigation-layout">
          <aside className="index-rail">
            <div className="rail-heading"><span>DIRECTORY</span><span>05 FILES</span></div>
            <nav className="archive-nav" aria-label="Archive sections">
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

          <section className="archive-content" aria-label="Archive records">
            <div className="content-topline">
              <div>
                <p className="micro-label">RECOVERED DOCUMENTS <span>/</span> {searchResults ? "SEARCH RESULTS" : activeSectionLabel.toUpperCase()}</p>
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
                {visibleRecords.map((record, index) => (
                  <button
                    type="button"
                    key={record.id}
                    className={`record-row${record.id === activeRecordId ? " is-selected" : ""}`}
                    onClick={() => setActiveRecordId(record.id)}
                    aria-pressed={record.id === activeRecordId}
                  >
                    <span className="record-order">{String(index + 1).padStart(2, "0")}</span>
                    <span className="record-row-main">
                      <span className="record-type">{record.type.replaceAll("_", " ")}</span>
                      <strong>{record.title}</strong>
                      <span className="record-row-meta">{record.id} <span>·</span> {record.author}</span>
                    </span>
                    <span className="record-row-side">
                      <time dateTime={record.date}>{record.date}</time>
                      <i className={`reliability-dot ${record.reliability}`} title={reliabilityLabel[record.reliability]} />
                    </span>
                  </button>
                ))}
              </div>
            )}

            {activeRecord && (
              <section className="record-detail" ref={detailRef} aria-labelledby="record-detail-title">
                <div className="detail-heading">
                  <div><p className="micro-label">DOCUMENT VIEW / {activeRecord.id}</p><h3 id="record-detail-title">{activeRecord.title}</h3></div>
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
                </div>
                <div className="detail-meta">
                  <span><small>DATE</small><time dateTime={activeRecord.date}>{activeRecord.date}</time></span>
                  <span><small>AUTHOR</small><strong>{activeRecord.author}</strong></span>
                  <span><small>TYPE</small><strong>{activeRecord.type.replaceAll("_", " ")}</strong></span>
                  <span><small>RELIABILITY</small><strong className={`reliability-text ${activeRecord.reliability}`}>{reliabilityLabel[activeRecord.reliability]}</strong></span>
                </div>
                <blockquote className="record-content">{activeRecord.content}</blockquote>
                <div className="tag-row" aria-label="Record tags">{activeRecord.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
              </section>
            )}
          </section>

          <aside className="utility-rail" aria-label="Investigation tools">
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

            <section className="curator-panel" aria-labelledby="curator-title">
              <div className="curator-heading">
                <div className="curator-seal" aria-hidden="true">C</div>
                <div><p className="micro-label">ARCHIVE ASSISTANT / LOCAL</p><h2 id="curator-title">Ask The Curator</h2></div>
              </div>
              <p className="panel-description">Ask a question about the recovered records. Answers are based on retrieved evidence.</p>
              <form className="curator-form" onSubmit={askCurator}>
                <label htmlFor="curator-question">YOUR QUESTION</label>
                <textarea
                  id="curator-question"
                  rows={3}
                  maxLength={MAX_QUESTION_LENGTH}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="What happened after the shutdown notice?"
                  disabled={isAsking}
                  aria-describedby="curator-help"
                />
                <div className="curator-form-foot"><small id="curator-help">{question.length}/{MAX_QUESTION_LENGTH}</small><button type="submit" disabled={isAsking}>{isAsking ? "CONSULTING…" : "ASK THE CURATOR →"}</button></div>
              </form>
              {curatorError && <p className="inline-error curator-error" role="alert">{curatorError}</p>}
              {isAsking && <p className="curator-loading" role="status"><span className="loading-mark" /> Reviewing archive evidence…</p>}
              {curatorResult && (
                <div className="curator-response" aria-live="polite">
                  <p className="micro-label">CURATOR RESPONSE</p>
                  <p className="curator-answer">{curatorResult.answer}</p>
                  <div className="source-block">
                    <span className="source-heading">SUPPORTING RECORDS</span>
                    {curatorResult.sources.length === 0 ? (
                      <p className="no-sources">No archive records were retrieved for this question.</p>
                    ) : (
                      <ul className="source-list">
                        {curatorResult.sources.map((source) => (
                          <li key={source.id}>
                            <button type="button" onClick={() => openRecord(source.id)}><span>{source.id}</span><strong>{source.title}</strong><time dateTime={source.date}>{source.date}</time></button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              <div className="curator-footnote">LOCAL MODEL <span>·</span> ANSWERS MAY NEED REVIEW</div>
            </section>
          </aside>
        </div>
        <footer className="browser-footer"><span>OCTOBER ONLINE ARCHIVE</span><span>RECONSTRUCTED FROM FIVE RECOVERED RECORDS</span><span>© 2009 / COPY PRESERVED</span></footer>
      </section>
      <footer className="page-footer"><span>ARCHIVE 09</span><span>INVESTIGATION INTERFACE / PHASE 03</span><span>PROGRESS IS SAVED IN THIS BROWSER</span></footer>
    </main>
  );
}
