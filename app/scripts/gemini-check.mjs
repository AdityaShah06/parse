/**
 * Ten-second check that your Gemini key works.
 *
 *   node scripts/gemini-check.mjs
 *
 * Reads GEMINI_API_KEY from app/.env.local, lists the models your key can use,
 * and asks one model for a tiny JSON answer. Paste the output to Claude.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://generativelanguage.googleapis.com/v1beta";

function readKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try {
    const line = readFileSync(join(appDir, ".env.local"), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("GEMINI_API_KEY="));
    if (line) return line.slice("GEMINI_API_KEY=".length).trim();
  } catch {}
  console.error("No key. Put GEMINI_API_KEY=... in app/.env.local");
  process.exit(1);
}

const headers = { "x-goog-api-key": readKey(), "content-type": "application/json" };

const list = await fetch(`${API}/models?pageSize=200`, { headers });
if (!list.ok) {
  console.error(`Listing models failed: HTTP ${list.status}`);
  console.error((await list.text()).slice(0, 500));
  process.exit(1);
}
const names = ((await list.json()).models ?? [])
  .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
  .map((m) => m.name.replace(/^models\//, ""))
  .filter((n) => /flash|pro/.test(n));
console.log("Models your key can use:", names.join(", "));

const model = process.env.GEMINI_MODEL ?? names.find((n) => /flash/.test(n) && !/lite|tts|image|live|audio/.test(n));
console.log("Testing with:", model);

const res = await fetch(`${API}/models/${model}:generateContent`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "Return the deductible from: 'Deductible: $1,500 individual'." }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        properties: { deductible: { type: ["number", "null"] } },
        required: ["deductible"],
      },
    },
  }),
});
console.log("generateContent:", res.status);
const body = await res.json();
console.log(body.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify(body).slice(0, 500));
