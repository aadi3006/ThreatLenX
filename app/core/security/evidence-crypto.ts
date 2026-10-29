/**
 * evidence-crypto.ts
 *
 * 100% offline cryptographic hashing engine for EXPLAIN-SEC SPATIAL.
 * Computes SHA-256 hashes over raw binary bytes (ArrayBuffer / Uint8Array) or UTF-8 strings.
 *
 * Uses native Web Crypto API (crypto.subtle) when available in the browser,
 * with seamless fallback to Node.js crypto module in headless test runners.
 *
 * Zero external calls, zero cloud hashing services, zero network dependencies.
 */

/**
 * Converts an ArrayBuffer to a lowercase hexadecimal string.
 */
export function bufferToHex(buffer: ArrayBuffer): string {
  const byteArray = new Uint8Array(buffer);
  let hexString = '';
  for (let i = 0; i < byteArray.length; i++) {
    const hex = byteArray[i].toString(16).padStart(2, '0');
    hexString += hex;
  }
  return hexString;
}

/**
 * Normalizes any binary or buffer-like input to an ArrayBuffer.
 */
export function toArrayBuffer(data: ArrayBuffer | Uint8Array | unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy.buffer;
  }
  if (typeof data === 'object' && data !== null) {
    // If serialized to array or object values
    const values = Array.isArray((data as any).data)
      ? (data as any).data
      : Object.values(data as Record<string, unknown>);
    const copy = new Uint8Array(values as number[]);
    return copy.buffer;
  }
  return new ArrayBuffer(0);
}

/**
 * Compute SHA-256 digest of an ArrayBuffer or binary data.
 * Returns lowercase 64-character hex string.
 */
export async function computeSha256(data: ArrayBuffer | Uint8Array | unknown): Promise<string> {
  const buffer = toArrayBuffer(data);

  // 1. Browser Web Crypto API (or modern Node with globalThis.crypto.subtle)
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    try {
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', buffer);
      return bufferToHex(hashBuffer);
    } catch {
      // Fall through to Node crypto if subtle fails
    }
  }

  // 2. Node.js native crypto fallback via dynamic import
  try {
    const nodeCrypto = await import('node:crypto');
    const hash = nodeCrypto.createHash('sha256');
    hash.update(Buffer.from(buffer));
    return hash.digest('hex');
  } catch (err) {
    throw new Error(`Failed to compute SHA-256 offline hash: ${(err as Error).message}`);
  }
}

/**
 * Compute SHA-256 digest of a UTF-8 string.
 */
export async function computeStringSha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text).buffer;
  return computeSha256(data);
}
