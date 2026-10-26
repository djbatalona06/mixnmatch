// Small security helpers built on the Web Crypto API (works in Workers and Node).

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(byteLength = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- PKCE (proof that the app finishing a login is the app that started it) ----

export function createCodeVerifier(): string {
  return randomToken(48);
}

export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

// ---- AES-256-GCM encryption for stored music-service tokens ----

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(base64Key: string): Promise<CryptoKey> {
  let key = keyCache.get(base64Key);
  if (!key) {
    const raw = fromBase64(base64Key);
    if (raw.length !== 32) throw new Error("TOKEN_KEY must be 32 bytes, base64 encoded");
    key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keyCache.set(base64Key, key);
  }
  return key;
}

/** Encrypts text. `context` (e.g. "user:platform") must match when decrypting. */
export async function encrypt(
  base64Key: string,
  plaintext: string,
  context: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await importKey(base64Key),
    encoder.encode(plaintext),
  );
  return { ciphertext: toBase64(new Uint8Array(data)), iv: toBase64(iv) };
}

export async function decrypt(
  base64Key: string,
  ciphertext: string,
  iv: string,
  context: string,
): Promise<string> {
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: encoder.encode(context) },
    await importKey(base64Key),
    fromBase64(ciphertext),
  );
  return decoder.decode(data);
}
