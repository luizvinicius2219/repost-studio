import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

type SignedPayload = Record<string, unknown> & { exp: number };

function encryptionKey(): Buffer {
  const raw = process.env.TIKTOK_TOKEN_ENCRYPTION_KEY ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) {
    throw new Error("TIKTOK_TOKEN_ENCRYPTION_KEY must be a 64-character hex value.");
  }
  return Buffer.from(raw, "hex");
}

function base64url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, base64url(iv), base64url(tag), base64url(encrypted)].join(".");
}

export function decryptSecret(value: string): string {
  const [version, ivText, tagText, cipherText] = value.split(".");
  if (version !== VERSION || !ivText || !tagText || !cipherText) throw new Error("Encrypted token format is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function signature(payloadText: string) {
  return createHmac("sha256", encryptionKey()).update(payloadText).digest("base64url");
}

export function signPayload(payload: SignedPayload): string {
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${signature(encoded)}`;
}

export function verifyPayload<T extends SignedPayload>(token: string): T {
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) throw new Error("Signed token is invalid.");
  const expected = signature(encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Signed token is invalid.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  if (!payload.exp || payload.exp < Date.now()) throw new Error("Signed token has expired.");
  return payload;
}

export function createOAuthState(accountId: string): string {
  return signPayload({ accountId, nonce: randomBytes(16).toString("hex"), exp: Date.now() + 10 * 60 * 1000 });
}

export function parseOAuthState(state: string): { accountId: string } {
  const parsed = verifyPayload<{ accountId: string; nonce: string; exp: number }>(state);
  if (!parsed.accountId) throw new Error("OAuth state is missing the account.");
  return { accountId: parsed.accountId };
}

export function createMediaToken(videoId: string): string {
  return signPayload({ videoId, exp: Date.now() + 90 * 60 * 1000 });
}

export function parseMediaToken(token: string): { videoId: string } {
  const parsed = verifyPayload<{ videoId: string; exp: number }>(token);
  if (!parsed.videoId) throw new Error("Media token is invalid.");
  return { videoId: parsed.videoId };
}
