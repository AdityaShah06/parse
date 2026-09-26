/**
 * Minimal Gemini client for server routes. Plain fetch, no SDK dependency.
 *
 * Server only: this reads GEMINI_API_KEY, which must never reach a browser.
 * Every call asks for JSON that matches a schema, and every caller validates
 * the result again, so a model that ignores the schema produces blanks, not
 * wrong numbers.
 */

const API = "https://generativelanguage.googleapis.com/v1beta";

export class NoKey extends Error {}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function key(): string {
  const k = process.env.GEMINI_API_KEY?.trim();
  if (!k) throw new NoKey("GEMINI_API_KEY is not set in app/.env.local");
  return k;
}

const headers = () => ({ "x-goog-api-key": key(), "content-type": "application/json" });

/** Newest first. The first one this key can use wins. */
const PREFERRED = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];

let cachedModel: string | null = null;

/**
 * Which model to call. GEMINI_MODEL wins if set. Otherwise ask the API which
 * models this key can use, so a renamed or retired model never breaks the demo.
 */
export async function model(): Promise<string> {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (cachedModel) return cachedModel;

  const res = await fetch(`${API}/models?pageSize=200`, { headers: headers() });
  if (!res.ok) throw new ApiError(`Could not list Gemini models (${res.status})`, res.status);
  const body = (await res.json()) as {
    models?: { name: string; supportedGenerationMethods?: string[] }[];
  };
  const usable = (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));

  cachedModel =
    PREFERRED.find((p) => usable.includes(p)) ??
    usable.find((n) => /flash/.test(n) && !/lite|tts|image|live|audio|embedding/.test(n)) ??
    usable[0] ??
    null;
  if (!cachedModel) throw new ApiError("No Gemini models available for this key", 500);
  return cachedModel;
}

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/**
 * One request in, one JSON object out. Tries native schema-constrained output
 * first; if the model or endpoint rejects the schema, retries with the schema
 * written into the prompt instead.
 */
export async function extractJson(opts: {
  system: string;
  parts: Part[];
  schema: unknown;
  maxTokens?: number;
}): Promise<unknown> {
  const m = await model();
  const base = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: opts.parts }],
  };

  const attempt = async (generationConfig: Record<string, unknown>, extraText?: string) => {
    const body = extraText
      ? { ...base, contents: [{ role: "user", parts: [...opts.parts, { text: extraText }] }] }
      : base;
    return fetch(`${API}/models/${m}:generateContent`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ...body, generationConfig }),
    });
  };

  const config = {
    responseMimeType: "application/json",
    maxOutputTokens: opts.maxTokens ?? 4000,
    temperature: 0,
  };

  let res = await attempt({ ...config, responseJsonSchema: opts.schema });
  if (res.status === 400) {
    res = await attempt(config, `Answer with only a JSON object matching this JSON Schema:\n${JSON.stringify(opts.schema)}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(`Gemini ${res.status}: ${text.slice(0, 300)}`, res.status);
  }

  const out = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ApiError("Gemini did not return valid JSON", 502);
  }
}
