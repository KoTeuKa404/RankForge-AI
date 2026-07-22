import { TargetValidationError } from "./security";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importSecret(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) {
    throw new TargetValidationError("GSC_TOKEN_SECRET must contain at least 32 characters.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importSecret(secret);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );
  const payload = new Uint8Array(iv.byteLength + encrypted.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(encrypted), iv.byteLength);
  return bytesToBase64(payload);
}

export async function decryptSecret(value: string, secret: string): Promise<string> {
  try {
    const payload = base64ToBytes(value);
    if (payload.byteLength < 13) throw new Error("Invalid payload");
    const iv = payload.slice(0, 12);
    const encrypted = payload.slice(12);
    const key = await importSecret(secret);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new TargetValidationError("Stored Search Console credentials could not be decrypted.");
  }
}
