import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// AES-256-GCM for secrets stored at rest (registrar credentials).
// Format: base64(iv).base64(authTag).base64(ciphertext)
// The key is derived from APP_SECRET; changing APP_SECRET makes existing values unreadable.

const INFO = "domain-brain:credentials:v1";

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", INFO, 32));
}

export function encrypt(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string, secret: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("Malformed encrypted value");
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64")) as [
    Buffer,
    Buffer,
    Buffer,
  ];
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
