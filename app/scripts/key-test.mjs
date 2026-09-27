/**
 * key-test v4. Checks GEMINI_API_KEY the same way the app calls Gemini.
 *
 *   node scripts/key-test.mjs      (run from the app folder)
 *
 * Sends the key as ?key= first (the way that works for AQ. keys), then as the
 * x-goog-api-key header. Never prints the key itself.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const STUDIO = "https://generativelanguage.googleapis.com/v1beta";
const MODELS = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];

function readKey() {
  try {
    const line = readFileSync(join(appDir, ".env.local"), "utf8")
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .find((l) => l.startsWith("PLAINLY_GEMINI_KEY=") || l.startsWith("GEMINI_API_KEY="));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {}
  return null;
}

async function main() {
  console.log("key-test v4 (query parameter first, 20 second limit per try)");
  const key = readKey();
  if (!key) {
    console.log("No GEMINI_API_KEY line in app/.env.local");
    return;
  }
  console.log(`Key in file: ${key.length} characters, starts with ${key.slice(0, 3)}`);

  const ping = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }], generationConfig: { maxOutputTokens: 5 } });

  for (const auth of ["query", "header"]) {
    for (const m of MODELS) {
      const url = `${STUDIO}/models/${m}:generateContent${auth === "query" ? `?key=${encodeURIComponent(key)}` : ""}`;
      const headers = auth === "query" ? { "content-type": "application/json" } : { "content-type": "application/json", "x-goog-api-key": key };
      process.stdout.write(`  ${auth} ${m}: `);
      let r;
      try {
        r = await fetch(url, { method: "POST", headers, body: ping, signal: AbortSignal.timeout(20000) });
      } catch (e) {
        const why = e?.name === "TimeoutError" ? "no answer in 20 seconds" : `${e?.cause?.code ?? ""} ${e?.message ?? e}`;
        console.log(`network error: ${why}`);
        continue;
      }
      if (r.ok) {
        console.log("OK");
        console.log(`\nWorking. The app will find this on its own. To skip the search, add to app/.env.local:\nGEMINI_MODEL=${m}`);
        console.log("Then restart npm run dev.");
        return;
      }
      const text = await r.text();
      const reason = (text.match(/"reason":\s*"([A-Z_]+)"/) ?? text.match(/"status":\s*"([A-Z_]+)"/) ?? [])[1] ?? "";
      console.log(`HTTP ${r.status} ${reason}`);
      if (/API_KEY_INVALID|UNAUTHENTICATED|PERMISSION_DENIED/.test(text)) break;
    }
  }
  console.log("\nNo combination worked. Paste this output back to Claude.");
}

// exitCode instead of process.exit(): exiting mid-request crashes Node on Windows.
main().catch((e) => {
  console.log("Error:", e?.message ?? e);
  process.exitCode = 1;
});
