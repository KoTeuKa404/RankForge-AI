const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".home", ".lan"];
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 8_000;

export class TargetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetValidationError";
  }
}

function parseIpv4(hostname: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const octets = hostname.split(".").map(Number);
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? octets
    : null;
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!normalized.includes(":")) return false;

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

export function normalizeTargetUrl(raw: string): URL {
  const value = raw.trim();
  if (!value) throw new TargetValidationError("Enter a URL to audit.");
  if (value.length > 2_048) throw new TargetValidationError("URL is too long.");

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new TargetValidationError("The URL is not valid.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TargetValidationError("Only HTTP and HTTPS URLs are supported.");
  }
  if (url.username || url.password) {
    throw new TargetValidationError("URLs containing credentials are not allowed.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || BLOCKED_HOSTS.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new TargetValidationError("Private or local network targets are not allowed.");
  }

  const ipv4 = parseIpv4(hostname);
  if ((ipv4 && isPrivateIpv4(ipv4)) || isBlockedIpv6(hostname)) {
    throw new TargetValidationError("Private or reserved IP addresses are not allowed.");
  }

  const explicitPort = url.port;
  if (explicitPort) {
    const allowed = (url.protocol === "https:" && explicitPort === "443") || (url.protocol === "http:" && explicitPort === "80");
    if (!allowed) throw new TargetValidationError("Only standard web ports 80 and 443 are allowed.");
  }

  url.hash = "";
  return url;
}

async function readBodyLimited(response: Response, limit = MAX_RESPONSE_BYTES): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > limit) throw new TargetValidationError("The remote page is too large to audit safely.");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new TargetValidationError("The remote page is too large to audit safely.");
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export interface SafeFetchResult {
  response: Response;
  body: string;
  finalUrl: URL;
  durationMs: number;
}

export async function safeFetchText(rawUrl: string | URL, init: RequestInit = {}): Promise<SafeFetchResult> {
  let current = normalizeTargetUrl(String(rawUrl));
  const started = Date.now();

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(current.toString(), {
        ...init,
        method: init.method || "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "RankForgeBot/0.1 (+technical SEO audit)",
          accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.1",
          ...(init.headers || {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "The remote server timed out."
        : "The remote server could not be reached.";
      throw new TargetValidationError(message);
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === MAX_REDIRECTS) throw new TargetValidationError("Too many redirects.");
      const location = response.headers.get("location");
      if (!location) throw new TargetValidationError("The server returned an invalid redirect.");
      current = normalizeTargetUrl(new URL(location, current).toString());
      continue;
    }

    const body = await readBodyLimited(response);
    return { response, body, finalUrl: current, durationMs: Date.now() - started };
  }

  throw new TargetValidationError("Unable to fetch the target.");
}

export function canonicalizeCrawlUrl(raw: string, base: URL): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin !== base.origin) return null;
    if (url.username || url.password) return null;

    url.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"]) {
      url.searchParams.delete(key);
    }
    url.searchParams.sort();

    const ignoredExtensions = /\.(?:jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|7z|mp4|webm|mp3|wav|css|js|json|xml|woff2?|ttf|eot)$/i;
    if (ignoredExtensions.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
