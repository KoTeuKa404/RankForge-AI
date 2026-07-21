export interface Env {
  DB?: D1Database;
  FILES?: R2Bucket;
  ASSETS?: Fetcher;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ENVIRONMENT?: string;
}

export interface Identity {
  email: string;
  name?: string;
}

export function getIdentity(request: Request): Identity | null {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!email) return null;

  const name = request.headers.get("oai-authenticated-user-full-name")?.trim();
  return { email, name: name || undefined };
}
