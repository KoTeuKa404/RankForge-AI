import type { Env } from "./env";
import { TargetValidationError } from "./security";

interface EmbeddingResponse {
  embedding?: { values?: number[] };
  error?: { message?: string };
}

const EMBEDDING_TIMEOUT_MS = 15_000;
const EMBEDDING_DIMENSIONS = 768;

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 12_000);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export async function embedText(
  env: Env,
  text: string,
  instruction = "task: semantic similarity",
): Promise<number[]> {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) throw new TargetValidationError("GEMINI_API_KEY is required for semantic analysis.");
  const model = env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-2";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          content: {
            parts: [{ text: `${instruction} | ${cleanText(text)}` }],
          },
          output_dimensionality: EMBEDDING_DIMENSIONS,
        }),
        signal: controller.signal,
      },
    );
    const payload = await response.json().catch(() => ({})) as EmbeddingResponse;
    if (!response.ok || !Array.isArray(payload.embedding?.values)) {
      throw new TargetValidationError(payload.error?.message || "Gemini embedding request failed.");
    }
    return payload.embedding.values.map(Number).filter(Number.isFinite);
  } catch (error) {
    if (error instanceof TargetValidationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new TargetValidationError("Gemini embedding request timed out.");
    }
    throw new TargetValidationError("Gemini embedding request failed.");
  } finally {
    clearTimeout(timer);
  }
}

export async function embedTexts(
  env: Env,
  texts: string[],
  instruction = "task: semantic similarity",
  concurrency = 4,
): Promise<number[][]> {
  const output: number[][] = new Array(texts.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < texts.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await embedText(env, texts[index], instruction);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), texts.length) }, () => worker()));
  return output;
}
