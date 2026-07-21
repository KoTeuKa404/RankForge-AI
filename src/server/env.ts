export interface Env {
  DB?: D1Database;
  FILES?: R2Bucket;
  ASSETS?: Fetcher;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  MONITOR_TOKEN?: string;
  DEV_USER_EMAIL?: string;
  ENVIRONMENT?: string;
}

export interface Identity {
  email: string;
  name?: string;
}

export function getIdentity(request: Request, env?: Env): Identity | null {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (email) {
    const name = request.headers.get("oai-authenticated-user-full-name")?.trim();
    return { email, name: name || undefined };
  }

  if (env?.ENVIRONMENT === "development" && env.DEV_USER_EMAIL) {
    const hostname = new URL(request.url).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
      return { email: env.DEV_USER_EMAIL.trim().toLowerCase(), name: "Local developer" };
    }
  }
  return null;
}
