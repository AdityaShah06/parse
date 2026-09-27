#!/usr/bin/env node
/**
 * Recompute in-network claim denial and appeal rates per issuer from the CMS
 * Transparency in Coverage public use file (plan year 2026 file, 2024 claims).
 *
 *   node scripts/build-denials.mjs              Missouri issuers
 *   node scripts/build-denials.mjs --all        every state
 *   node scripts/build-denials.mjs --state KS   another state
 *   node scripts/build-denials.mjs --file path  use a local .zip, .xlsx or .csv
 *   node scripts/build-denials.mjs --headers    list the file's columns and stop
 *
 * Node 20 or newer. No npm packages: the ZIP and XLSX readers below are
 * minimal and only handle what this file needs (stored or deflated entries,
 * shared strings, the first worksheet).
 *
 * Writes data/denials-2024.json and prints a table. Denial rate is
 * claims denied in network / claims received in network, per issuer.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const URL_ZIP = "https://download.cms.gov/marketplace-puf/2026/transparency-in-coverage-puf.zip";
const DICTIONARY = "https://www.cms.gov/files/document/transparency-coverage-puf-datadictionary-py25.pdf";
const CLAIMS_YEAR = 2024;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data", "raw", "transparency-in-coverage-puf-2026.zip");
const OUT = join(ROOT, "data", "denials-2024.json");

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ALL = flag("--all");
const STATE = (opt("--state") ?? "MO").toUpperCase();
const LOCAL = opt("--file");
const HEADERS_ONLY = flag("--headers");

/* ------------------------------------------------------------------ */
/* ZIP                                                                 */
/* ------------------------------------------------------------------ */

/** List entries from the central directory. Handles ZIP64 sizes and offsets. */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file (no end of central directory record)");

  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  // ZIP64 end of central directory locator sits just before the EOCD.
  if ((cdOffset === 0xffffffff || count === 0xffff) && eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) {
    const z64 = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    if (buf.readUInt32LE(z64) === 0x06064b50) {
      count = Number(buf.readBigUInt64LE(z64 + 32));
      cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
    }
  }

  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`Bad central directory entry at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20);
    let usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    // ZIP64 extra field (0x0001) holds whichever values overflowed, in order.
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = buf.readUInt16LE(e);
      const size = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (usize === 0xffffffff) (usize = Number(buf.readBigUInt64LE(q))), (q += 8);
        if (csize === 0xffffffff) (csize = Number(buf.readBigUInt64LE(q))), (q += 8);
        if (local === 0xffffffff) local = Number(buf.readBigUInt64LE(q));
      }
      e += 4 + size;
    }
    entries.push({ name, method, csize, usize, local });
    p = eEnd + commentLen;
  }
  return entries;
}

export function unzipEntry(buf, entry) {
  const p = entry.local;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`Bad local header for ${entry.name}`);
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + entry.csize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

/* ------------------------------------------------------------------ */
/* XLSX                                                                */
/* ------------------------------------------------------------------ */

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

const textRuns = (xml) => {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
};

function colIndex(ref) {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Read the first worksheet of an .xlsx buffer into an array of string rows. */
export function readXlsx(buf) {
  const entries = readZip(buf);
  const get = (name) => {
    const e = entries.find((x) => x.name === name);
    return e ? unzipEntry(buf, e).toString("utf8") : null;
  };

  const shared = [];
  const ss = get("xl/sharedStrings.xml");
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(m[1]));

  // First sheet in workbook order, via the relationships file; fall back to sheet1.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = get("xl/workbook.xml");
  const rels = get("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    // The PUF opens with a disclaimer sheet; the data is the "Ind QHP" sheet.
    const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]);
    const pick = sheets.find((t) => /Ind QHP/i.test(t)) ?? sheets.find((t) => !/disclaimer/i.test(t)) ?? sheets[0];
    const first = pick?.match(/\br:id="([^"]+)"/);
    if (first) {
      const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)]
        .map((m) => m[0])
        .find((tag) => tag.includes(`Id="${first[1]}"`));
      const target = rel?.match(/Target="([^"]+)"/)?.[1];
      if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    }
  }
  const sheet = get(sheetPath);
  if (!sheet) throw new Error(`Worksheet ${sheetPath} not found in the workbook`);

  const rows = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const idx = ref ? colIndex(ref) : row.length;
      let val = "";
      if (type === "inlineStr") val = textRuns(body);
      else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (v !== undefined) val = type === "s" ? (shared[Number(v)] ?? "") : decodeXml(v);
      }
      row[idx] = val;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
    rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export function readCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) row.push(field), rows.push(row);
  return rows;
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
const isIn = (h) => /\bin network\b|\bin net\b|\binn\b/.test(h);
const isOut = (h) => /\bout of network\b|\boon\b|\bnon network\b/.test(h);
const isRate = (h) => /%|\bpercent\b|\brate\b/.test(h);

/**
 * Column tests, matched against lowercased headers with underscores and
 * punctuation turned into spaces. The data dictionary names both issuer-level
 * and plan-level columns; issuer-level ones are preferred (they are repeated
 * on each plan row and already cover the whole issuer). Among matches,
 * in-network columns win, then the shortest header (the generic total rather
 * than a by-reason breakdown like "claims denied referral required").
 */
const COLUMNS = {
  state: (h) => /^state\b|\bstate code\b|^st$/.test(h),
  issuerId: (h) => /\bissuer\b.*\bid\b|\bhios issuer\b/.test(h) && !/\bplan\b/.test(h),
  issuerName: (h) => /\bissuer\b.*\bname\b|\bissuer legal name\b|\bmarketing name\b/.test(h),
  planId: (h) => /\bplan\b.*\bid\b/.test(h),
  received: (h) => /\bclaims?\b/.test(h) && /\breceiv/.test(h) && !isOut(h) && !isRate(h),
  denied: (h) => /\bclaims?\b/.test(h) && /\bden(ied|ial|ials|y)\b/.test(h) && !isOut(h) && !isRate(h),
  appealsFiled: (h) => /\binternal appeals?\b/.test(h) && /\bfiled\b/.test(h) && !isRate(h),
  appealsOverturned: (h) => /\binternal appeals?\b/.test(h) && /\boverturn/.test(h) && !isRate(h),
};

function pick(headers, test) {
  const hits = headers
    .map((raw, i) => ({ h: norm(raw), i }))
    .filter(({ h }) => test(h))
    .sort((a, b) => Number(isIn(b.h)) - Number(isIn(a.h)) || a.h.length - b.h.length || a.i - b.i);
  const issuer = hits.find(({ h }) => /\bissuer\b/.test(h));
  const plan = hits.find(({ h }) => /\bplan\b/.test(h));
  return { issuer: issuer?.i, plan: plan?.i, any: hits[0]?.i };
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const hs = rows[i].map(norm);
    if (hs.some((h) => COLUMNS.state(h)) && hs.some((h) => /\bissuer\b/.test(h))) return i;
  }
  throw new Error("Could not find a header row with State and Issuer columns. Run with --headers to inspect.");
}

const num = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[,$\s]/g, "");
  if (s === "" || /^[*]+$/.test(s) || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function loadBuffer() {
  if (LOCAL) return { buf: readFileSync(resolve(LOCAL)), name: LOCAL };
  if (existsSync(RAW)) {
    console.log(`Using cached ${RAW}`);
    return { buf: readFileSync(RAW), name: RAW };
  }
  console.log(`Downloading ${URL_ZIP}`);
  const res = await fetch(URL_ZIP);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(RAW), { recursive: true });
  writeFileSync(RAW, buf);
  console.log(`Saved ${(buf.length / 1e6).toFixed(1)} MB to ${RAW}`);
  return { buf, name: RAW };
}

function tableFrom(buf, name) {
  const ext = extname(name).toLowerCase();
  if (ext === ".csv") return { rows: readCsv(buf.toString("utf8")), inner: name };
  const isZip = buf.readUInt32LE(0) === 0x04034b50;
  if (!isZip) return { rows: readCsv(buf.toString("utf8")), inner: name };
  const entries = readZip(buf);
  if (entries.some((e) => e.name === "xl/workbook.xml")) return { rows: readXlsx(buf), inner: name };
  const data = entries
    .filter((e) => /\.(xlsx|csv)$/i.test(e.name) && !/dictionary|readme/i.test(e.name))
    .sort((a, b) => b.usize - a.usize);
  if (!data.length) throw new Error(`No .xlsx or .csv inside the zip. Entries: ${entries.map((e) => e.name).join(", ")}`);
  const pickEntry = data[0];
  const inner = unzipEntry(buf, pickEntry);
  console.log(`Reading ${pickEntry.name} (${(pickEntry.usize / 1e6).toFixed(1)} MB)`);
  return {
    rows: /\.csv$/i.test(pickEntry.name) ? readCsv(inner.toString("utf8")) : readXlsx(inner),
    inner: pickEntry.name,
  };
}

export function aggregate(rows, { all = false, state = "MO" } = {}) {
  const hi = findHeaderRow(rows);
  const headers = rows[hi];
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, t]) => [k, pick(headers, t)]));
  const need = ["state", "issuerName", "received", "denied"];
  const lacking = need.filter((k) => col[k].any === undefined);
  if (lacking.length) {
    throw new Error(
      `Missing columns: ${lacking.join(", ")}. Headers: ${headers.map((h) => `"${h}"`).join(", ")}. Check ${DICTIONARY}`,
    );
  }

  const byIssuer = new Map();
  for (const r of rows.slice(hi + 1)) {
    const st = String(r[col.state.any] ?? "").trim().toUpperCase();
    if (!st) continue;
    if (!all && st !== state) continue;
    const name = String(r[col.issuerName.any] ?? "").trim();
    const id = col.issuerId.any !== undefined ? String(r[col.issuerId.any] ?? "").trim() : "";
    const key = `${st}|${id || name}`;
    let agg = byIssuer.get(key);
    if (!agg) {
      agg = { state: st, issuerId: id || null, issuerName: name, plans: new Set(), issuerLevel: {}, planSum: {} };
      byIssuer.set(key, agg);
    }
    if (col.planId.any !== undefined) agg.plans.add(String(r[col.planId.any]));
    for (const k of ["received", "denied", "appealsFiled", "appealsOverturned"]) {
      // Issuer-level column: repeated per plan row, so keep one value (the max).
      if (col[k].issuer !== undefined) {
        const v = num(r[col[k].issuer]);
        if (v !== null) agg.issuerLevel[k] = Math.max(agg.issuerLevel[k] ?? 0, v);
      }
      // Plan-level column: sum across plans.
      const pc = col[k].plan ?? (col[k].issuer === undefined ? col[k].any : undefined);
      if (pc !== undefined) {
        const v = num(r[pc]);
        if (v !== null) agg.planSum[k] = (agg.planSum[k] ?? 0) + v;
      }
    }
  }

  const round = (x) => (x === null ? null : Math.round(x * 10000) / 100);
  const out = [...byIssuer.values()].map((a) => {
    const val = (k) => a.issuerLevel[k] ?? a.planSum[k] ?? null;
    const received = val("received");
    const denied = val("denied");
    const filed = val("appealsFiled");
    const overturned = val("appealsOverturned");
    return {
      state: a.state,
      issuerId: a.issuerId,
      issuerName: a.issuerName,
      planCount: a.plans.size || null,
      claimsReceivedInNetwork: received,
      claimsDeniedInNetwork: denied,
      denialRatePct: received ? round(denied / received) : null,
      internalAppealsFiled: filed,
      internalAppealsOverturned: overturned,
      overturnRatePct: filed ? round(overturned / filed) : null,
      appealUpheldRatePct: filed && overturned !== null ? round(1 - overturned / filed) : null,
      level: Object.keys(a.issuerLevel).length ? "issuer columns" : "sum of plan columns",
    };
  });
  out.sort((x, y) => x.state.localeCompare(y.state) || (x.denialRatePct ?? 999) - (y.denialRatePct ?? 999));
  const columns = Object.fromEntries(
    Object.entries(col).map(([k, c]) => [k, c.issuer ?? c.plan ?? c.any]).map(([k, i]) => [k, i === undefined ? null : headers[i]]),
  );
  const inNetworkOnly = [columns.received, columns.denied].every((h) => h !== null && isIn(norm(h)));
  return { rows: out, columns, headers, inNetworkOnly };
}

function printTable(rows) {
  const fmt = (n) => (n === null ? "-" : n.toLocaleString("en-US"));
  const pct = (n) => (n === null ? "-" : `${n.toFixed(1)}%`);
  const lines = [["St", "Issuer ID", "Issuer", "Received", "Denied", "Denial", "Appeals", "Overturned", "Overturn"]];
  for (const r of rows) {
    lines.push([
      r.state,
      r.issuerId ?? "-",
      r.issuerName.slice(0, 44),
      fmt(r.claimsReceivedInNetwork),
      fmt(r.claimsDeniedInNetwork),
      pct(r.denialRatePct),
      fmt(r.internalAppealsFiled),
      fmt(r.internalAppealsOverturned),
      pct(r.overturnRatePct),
    ]);
  }
  const widths = lines[0].map((_, i) => Math.max(...lines.map((l) => String(l[i]).length)));
  for (const [n, l] of lines.entries()) {
    console.log(l.map((c, i) => (i >= 3 ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join("  "));
    if (n === 0) console.log(widths.map((w) => "-".repeat(w)).join("  "));
  }
}

async function main() {
  const { buf, name } = await loadBuffer();
  const { rows, inner } = tableFrom(buf, name);
  if (HEADERS_ONLY) {
    const hi = findHeaderRow(rows);
    rows[hi].forEach((h, i) => console.log(`${i}\t${h}`));
    return;
  }
  const result = aggregate(rows, { all: ALL, state: STATE });
  console.log("Columns used:");
  for (const [k, h] of Object.entries(result.columns)) console.log(`  ${k.padEnd(18)} ${h ?? "(not found)"}`);
  if (!result.inNetworkOnly) {
    console.log(
      "\nWARNING: no in-network claim columns found; rates below use total claims. KFF's published rates are in-network only.",
    );
  }
  console.log("");
  printTable(result.rows);

  const doc = {
    source: "CMS Transparency in Coverage PUF, plan year 2026 file",
    url: URL_ZIP,
    dataDictionary: DICTIONARY,
    claimsYear: CLAIMS_YEAR,
    fetchedAt: new Date().toISOString(),
    inputFile: inner,
    scope: ALL ? "all states" : STATE,
    method:
      "Per issuer: denial rate = in-network claims denied / in-network claims received; overturn rate = internal appeals overturned / internal appeals filed. Issuer-level columns are used when the file has them, otherwise plan rows are summed.",
    columns: result.columns,
    inNetworkOnly: result.inNetworkOnly,
    rows: result.rows,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
  console.log(`\nWrote ${result.rows.length} issuers to ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
