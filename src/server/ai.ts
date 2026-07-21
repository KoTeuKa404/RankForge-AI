import type { AiFix, PageAudit, SeoIssue } from "../shared/types";
import type { Env } from "./env";

function extractOutputText(payload: unknown): string {
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

function parseJsonObject(raw: string): AiFix {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return valid JSON.");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<AiFix>;
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

export async function generateAiFix(env: Env, issue: SeoIssue, page: PageAudit | undefined, userKey: string): Promise<AiFix> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in hosted secrets.");
  const model = env.OPENAI_MODEL || "gpt-5.6-luna";
  const pageContext = page
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

  const response = await fetch("https://api.openai.com/v1/responses", {
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
          content: [{
            type: "input_text",
            text: "You are a senior technical SEO engineer. Give conservative, standards-compliant fixes. Do not promise rankings. Return only a JSON object with keys summary, whyItMatters, implementation, code, verification. verification must be an array of short checks. code may be an empty string.",
          }],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify({ issue, page: pageContext }),
          }],
        },
      ],
    }),
  });

  const payload = await response.json<unknown>();
  if (!response.ok) {
    const message = payload && typeof payload === "object"
      ? JSON.stringify(payload).slice(0, 600)
      : `OpenAI API returned ${response.status}`;
    throw new Error(message);
  }
  return parseJsonObject(extractOutputText(payload));
}
