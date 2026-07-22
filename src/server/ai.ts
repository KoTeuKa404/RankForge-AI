import type { AiFix, PageAudit, SeoIssue } from "../shared/types";
import type { Env } from "./env";

export type AiProvider = "openai" | "gemini";
export type AiProviderMode = AiProvider | "auto";

export interface AiProviderStatus {
  enabled: boolean;
  mode: AiProviderMode | "invalid";
  available: AiProvider[];
  preferred: AiProvider | null;
}

const SYSTEM_PROMPT = "You are a senior technical SEO engineer. Give conservative, standards-compliant fixes. Do not promise rankings. Return only a JSON object with keys summary, whyItMatters, implementation, code, verification. verification must be an array of short checks. code may be an empty string.";
const AI_TIMEOUT_MS = 35_000;

function extractOpenAiOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as Record<string, unknown>;
  if (typeof data.output_text === "string") return data.output_text;

  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[]
      : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
        return (part as Record<string, unknown>).text as string;
      }
    }
  }
  return "";
}

function extractGeminiOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const candidates = Array.isArray((payload as Record<string, unknown>).candidates)
    ? (payload as Record<string, unknown>).candidates as unknown[]
    : [];
  const texts: string[] = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== "object") continue;
    const parts = Array.isArray((content as Record<string, unknown>).parts)
      ? (content as Record<string, unknown>).parts as unknown[]
      : [];
    for (const part of parts) {
      if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
        texts.push((part as Record<string, unknown>).text as string);
      }
    }
  }
  return texts.join("\n").trim();
}

function parseJsonObject(raw: string): AiFix {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return valid JSON.");
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Partial<AiFix>;
  if (!parsed.summary || !parsed.implementation || !parsed.whyItMatters) {
    throw new Error("The model response is missing required fields.");
  }
  return {
    summary: String(parsed.summary),
    whyItMatters: String(parsed.whyItMatters),
    implementation: String(parsed.implementation),
    code: parsed.code ? String(parsed.code) : undefined,
    verification: Array.isArray(parsed.verification) ? parsed.verification.map(String).slice(0, 8) : [],
  };
}

async function safetyIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function providerMode(env: Env): AiProviderMode {
  const raw = (env.AI_PROVIDER || "auto").trim().toLowerCase();
  if (raw === "auto" || raw === "openai" || raw === "gemini") return raw;
  throw new Error("AI_PROVIDER must be one of: auto, openai, gemini.");
}

function availableProviders(env: Env): AiProvider[] {
  const available: AiProvider[] = [];
  if (env.OPENAI_API_KEY?.trim()) available.push("openai");
  if (env.GEMINI_API_KEY?.trim()) available.push("gemini");
  return available;
}

export function getAiProviderStatus(env: Env): AiProviderStatus {
  const available = availableProviders(env);
  let mode: AiProviderMode | "invalid" = "auto";
  try {
    mode = providerMode(env);
  } catch {
    mode = "invalid";
  }
  const preferred = mode === "openai" || mode === "gemini"
    ? (available.includes(mode) ? mode : null)
    : available[0] || null;
  return { enabled: available.length > 0 && mode !== "invalid", mode, available, preferred };
}

function providerOrder(env: Env): AiProvider[] {
  const mode = providerMode(env);
  const available = availableProviders(env);
  if (mode === "openai") {
    if (!available.includes("openai")) throw new Error("OPENAI_API_KEY is not configured in hosted secrets.");
    return ["openai"];
  }
  if (mode === "gemini") {
    if (!available.includes("gemini")) throw new Error("GEMINI_API_KEY is not configured in hosted secrets.");
    return ["gemini"];
  }
  if (available.length === 0) {
    throw new Error("Configure OPENAI_API_KEY or GEMINI_API_KEY in hosted secrets.");
  }
  return available;
}

function pageContext(page: PageAudit | undefined): Record<string, unknown> | undefined {
  return page
    ? {
        url: page.url,
        title: page.title,
        description: page.description,
        h1: page.h1,
        canonical: page.canonical,
        robots: page.robots,
        wordCount: page.wordCount,
      }
    : undefined;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("The AI provider timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function providerError(provider: string, response: Response, payload: unknown): Error {
  const details = payload && typeof payload === "object"
    ? JSON.stringify(payload).slice(0, 700)
    : `${provider} API returned ${response.status}`;
  return new Error(`${provider} API error (${response.status}): ${details}`);
}

async function generateOpenAiFix(env: Env, issue: SeoIssue, page: PageAudit | undefined, userKey: string): Promise<AiFix> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in hosted secrets.");
  const model = env.OPENAI_MODEL?.trim() || "gpt-5";
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      safety_identifier: await safetyIdentifier(userKey),
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify({ issue, page: pageContext(page) }) }],
        },
      ],
    }),
  });

  const payload = await response.json() as unknown;
  if (!response.ok) throw providerError("OpenAI", response, payload);
  return parseJsonObject(extractOpenAiOutputText(payload));
}

function normalizeGeminiModel(raw?: string): string {
  const model = (raw || "gemini-3.5-flash").trim().replace(/^models\//i, "");
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(model)) throw new Error("GEMINI_MODEL contains invalid characters.");
  return model;
}

async function generateGeminiFix(env: Env, issue: SeoIssue, page: PageAudit | undefined): Promise<AiFix> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured in hosted secrets.");
  const model = normalizeGeminiModel(env.GEMINI_MODEL);
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify({ issue, page: pageContext(page) }) }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1_500,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              whyItMatters: { type: "string" },
              implementation: { type: "string" },
              code: { type: "string" },
              verification: {
                type: "array",
                items: { type: "string" },
                maxItems: 8,
              },
            },
            required: ["summary", "whyItMatters", "implementation", "verification"],
            additionalProperties: false,
          },
        },
      }),
    },
  );

  const payload = await response.json() as unknown;
  if (!response.ok) throw providerError("Gemini", response, payload);
  const output = extractGeminiOutputText(payload);
  if (!output) throw new Error("Gemini returned no text output.");
  return parseJsonObject(output);
}

export async function generateAiFix(env: Env, issue: SeoIssue, page: PageAudit | undefined, userKey: string): Promise<AiFix> {
  const failures: string[] = [];
  for (const provider of providerOrder(env)) {
    try {
      return provider === "openai"
        ? await generateOpenAiFix(env, issue, page, userKey)
        : await generateGeminiFix(env, issue, page);
    } catch (error) {
      failures.push(`${provider}: ${error instanceof Error ? error.message : "Unknown provider failure"}`);
    }
  }
  throw new Error(`AI generation failed. ${failures.join(" | ")}`);
}
