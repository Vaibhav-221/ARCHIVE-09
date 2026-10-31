import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const archive = JSON.parse(fs.readFileSync(new URL("../data/archive.json", import.meta.url), "utf8"));
const { validateArchive } = loadTypeScript("lib/archive.ts");
const { normalizeSearchText, searchArchive } = loadTypeScript("lib/retrieval.ts", { "../data/archive.json": archive });

test("canonical archive has nine valid unique records", () => {
  assert.equal(archive.length, 9);
  assert.equal(validateArchive(archive), true);
  assert.equal(new Set(archive.map((record) => record.id)).size, 9);
  for (const record of archive) assert.equal(searchArchive(record.id, 1)[0]?.id, record.id);
});

test("search normalizes case, punctuation, Unicode, and tags", () => {
  assert.equal(normalizeSearchText("Wrong—Copy"), "wrong copy");
  assert.equal(normalizeSearchText("Cafe\u0301"), "café");
  assert.equal(searchArchive("WRONG copy", 1)[0]?.id, "ARC-003");
  assert.equal(searchArchive("mirror-02", 1)[0]?.id, "ARC-004");
  assert.equal(searchArchive("night_owl", 1)[0]?.author, "night_owl");
});

test("search includes dates and types, returns deterministic limits, and handles misses", () => {
  assert.equal(searchArchive("2009-10-18", 1)[0]?.id, "ARC-007");
  assert.equal(searchArchive("metadata report", 1)[0]?.id, "ARC-007");
  assert.deepEqual(searchArchive("nebula quasar"), []);
  assert.equal(searchArchive("forum", 2).length, 2);
  assert.deepEqual(searchArchive("   "), []);
  assert.deepEqual(searchArchive("forum", 0), []);
});
