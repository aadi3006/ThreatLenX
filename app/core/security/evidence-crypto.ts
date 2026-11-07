/**
 * evidence-crypto.ts
 *
 * 100% offline cryptographic hashing engine for EXPLAIN-SEC SPATIAL.
 * Computes SHA-256 hashes over raw binary bytes (ArrayBuffer / Uint8Array) or UTF-8 strings.
 *
 * Exclusively uses native Web Crypto API (crypto.subtle).
 * In unsupported environments (e.g., non-secure browser contexts without crypto.subtle),
 * throws a clear unsupported-context error and never substitutes a fake hash.
 *
 * Zero external calls, zero cloud hashing services, zero network dependencies.
 */

/**
 * Returns the native Web Crypto SubtleCrypto instance if available in the current context.
 * Throws a clear unsupported-context error otherwise.
 */
export function getSubtleCrypto(): SubtleCrypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error(
    'Unsupported context: Web Crypto API (crypto.subtle) is not available. A secure context (HTTPS or localhost) is required for cryptographic hashing.'
  );
}

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
 * Checks whether an array consists entirely of valid byte values (integers 0..255).
 */
function isValidByteArray(arr: unknown[]): arr is number[] {
  return arr.every(
    (b) => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 255
  );
}

/**
 * Normalizes and strictly validates binary payload formats to an ArrayBuffer.
 * Rejects malformed objects, invalid types, and non-byte arrays rather than
 * silently coercing them into arbitrary bytes.
 *
 * Supported formats:
 * - ArrayBuffer
 * - ArrayBufferView (Uint8Array, Int8Array, DataView, etc.)
 * - Serialized byte containers: { type: 'Buffer', data: number[] } or { data: ArrayBuffer | ArrayBufferView | number[] }
 * - Byte arrays (number[]) where every element is an integer in [0, 255]
 */
export function toArrayBuffer(data: ArrayBuffer | Uint8Array | unknown): ArrayBuffer {
  if (data === null || data === undefined) {
    throw new TypeError('Invalid payload: Expected binary data, received null or undefined.');
  }

  // 1. Native ArrayBuffer
  if (data instanceof ArrayBuffer) {
    return data;
  }

  // 2. TypedArray / ArrayBufferView
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy.buffer;
  }

  // 3. Raw array of byte numbers
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return new ArrayBuffer(0);
    }
    if (!isValidByteArray(data)) {
      throw new TypeError(
        'Invalid payload format: Array must contain only valid byte values (integers 0-255).'
      );
    }
    return new Uint8Array(data).buffer;
  }

  // 4. Object representations of binary data
  if (typeof data === 'object') {
    const record = data as Record<string, unknown>;

    // 4a. Persisted / Serialized Buffer format: { type: 'Buffer', data: number[] }
    if (record.type === 'Buffer' && Array.isArray(record.data)) {
      if (!isValidByteArray(record.data)) {
        throw new TypeError(
          'Invalid payload format: Serialized Buffer data must contain only valid byte values (integers 0-255).'
        );
      }
      return new Uint8Array(record.data).buffer;
    }

    // 4b. Storage blob wrapper: { data: ArrayBuffer | ArrayBufferView | number[] }
    if ('data' in record && record.data !== null && record.data !== undefined) {
      if (record.data instanceof ArrayBuffer) {
        return record.data;
      }
      if (ArrayBuffer.isView(record.data)) {
        const view = record.data;
        const copy = new Uint8Array(view.byteLength);
        copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        return copy.buffer;
      }
      if (Array.isArray(record.data)) {
        if (!isValidByteArray(record.data)) {
          throw new TypeError(
            'Invalid payload format: Wrapped data array must contain only valid byte values (integers 0-255).'
          );
        }
        return new Uint8Array(record.data).buffer;
      }
      throw new TypeError(
        'Invalid payload format: Wrapped data property must be an ArrayBuffer, TypedArray, or byte array.'
      );
    }

    // Any other arbitrary object is malformed
    throw new TypeError(
      'Invalid payload format: Malformed binary payload object. Expected ArrayBuffer, TypedArray, or valid buffer representation.'
    );
  }

  // 5. Primitive types (strings, numbers, booleans, etc.) are not binary payloads
  if (typeof data === 'string') {
    throw new TypeError(
      'Invalid payload format: Received string instead of binary data. Use computeStringSha256 for text payloads.'
    );
  }

  throw new TypeError(
    `Invalid payload format: Unsupported type "${typeof data}". Expected ArrayBuffer or Uint8Array.`
  );
}

/**
 * Compute SHA-256 digest of an ArrayBuffer or binary data using Web Crypto API.
 * Returns lowercase 64-character hex string.
 *
 * Throws an unsupported-context error if Web Crypto is unavailable.
 * Throws a TypeError if the payload format is malformed or invalid.
 */
export async function computeSha256(data: ArrayBuffer | Uint8Array | unknown): Promise<string> {
  const buffer = toArrayBuffer(data);
  const subtle = getSubtleCrypto();
  const hashBuffer = await subtle.digest('SHA-256', buffer);
  return bufferToHex(hashBuffer);
}

/**
 * Compute SHA-256 digest of a UTF-8 string using Web Crypto API.
 * Returns lowercase 64-character hex string.
 *
 * Throws an unsupported-context error if Web Crypto is unavailable.
 * Throws a TypeError if input is not a string.
 */
export async function computeStringSha256(text: string): Promise<string> {
  if (typeof text !== 'string') {
    throw new TypeError(
      `Invalid payload: Expected string, received ${text === null ? 'null' : typeof text}.`
    );
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  return computeSha256(data);
}
