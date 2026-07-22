import { TargetValidationError } from "./security";

interface DnsAnswer {
  type?: number;
  data?: string;
}

interface DnsJsonResponse {
  Status?: number;
  Answer?: DnsAnswer[];
}

function parseIpv4(value: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

export function isBlockedResolvedAddress(value: string): boolean {
  const ipv4 = parseIpv4(value);
  if (ipv4) {
    const [a, b, c] = ipv4;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && c === 2)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }

  const address = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (!address.includes(":")) return true;
  return address === "::"
    || address === "::1"
    || address.startsWith("fc")
    || address.startsWith("fd")
    || /^fe[89ab]/.test(address)
    || address.startsWith("ff")
    || address.startsWith("2001:db8:")
    || address.startsWith("::ffff:127.")
    || address.startsWith("::ffff:10.")
    || address.startsWith("::ffff:192.168.")
    || address.startsWith("::ffff:169.254.");
}

async function query(hostname: string, type: "A" | "AAAA"): Promise<string[]> {
  const endpoint = new URL("https://cloudflare-dns.com/dns-query");
  endpoint.searchParams.set("name", hostname);
  endpoint.searchParams.set("type", type);
  endpoint.searchParams.set("do", "true");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_500);
  try {
    const response = await fetch(endpoint, {
      headers: { accept: "application/dns-json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new TargetValidationError("DNS validation failed for the target host.");
    const payload = await response.json() as DnsJsonResponse;
    if (payload.Status !== 0 && payload.Status !== 3) {
      throw new TargetValidationError("DNS validation failed for the target host.");
    }
    const wanted = type === "A" ? 1 : 28;
    return (payload.Answer || [])
      .filter((answer) => answer.type === wanted && typeof answer.data === "string")
      .map((answer) => answer.data!.trim());
  } catch (error) {
    if (error instanceof TargetValidationError) throw error;
    throw new TargetValidationError("DNS validation timed out for the target host.");
  } finally {
    clearTimeout(timer);
  }
}

export async function assertPublicDnsTarget(hostname: string): Promise<void> {
  if (parseIpv4(hostname) || hostname.includes(":")) {
    if (isBlockedResolvedAddress(hostname)) {
      throw new TargetValidationError("The target resolves to a private or reserved IP address.");
    }
    return;
  }

  const [ipv4, ipv6] = await Promise.all([query(hostname, "A"), query(hostname, "AAAA")]);
  const addresses = [...ipv4, ...ipv6];
  if (addresses.length === 0) throw new TargetValidationError("The target hostname did not resolve to a public address.");
  if (addresses.some(isBlockedResolvedAddress)) {
    throw new TargetValidationError("The target resolves to a private or reserved IP address.");
  }
}
