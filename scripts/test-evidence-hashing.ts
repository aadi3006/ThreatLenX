/**
 * scripts/test-evidence-hashing.ts
 *
 * Dedicated verification suite for Batch 3 — Evidence Hashing:
 * 1. Known SHA-256 test vectors (RFC 6234 / NIST standards & canonical seed hashes).
 * 2. Supported payload formats:
 *    - ArrayBuffer
 *    - Uint8Array / TypedArray views with offsets
 *    - Valid raw byte arrays (number[] with integers 0..255)
 *    - Serialized Buffer objects ({ type: 'Buffer', data: number[] })
 *    - Persisted storage blob wrapper objects ({ data: Uint8Array | ArrayBuffer | number[] })
 *    - UTF-8 text strings via computeStringSha256
 * 3. Strict rejection of malformed inputs:
 *    - null / undefined
 *    - Primitive numbers, booleans, symbols, functions
 *    - Strings passed to computeSha256 directly
 *    - Non-strings passed to computeStringSha256
 *    - Arbitrary / malformed objects (e.g. { foo: 'bar' }, {})
 *    - Arrays with non-bytes (strings, floats, negative numbers, numbers > 255)
 * 4. Unavailable Web Crypto context:
 *    - Throws clear unsupported-context error
 *    - Never returns a substitute or fake hash
 * 5. Isolated Storage & Integrity Persistence:
 *    - Seed evidence hash preservation (EVD-000001, EVD-000002, EVD-000003)
 *    - Custody history integrity verification
 *    - Binary payload storage and verification
 *    - Tampering detection without overwriting stored hashes
 */

import {
  computeSha256,
  computeStringSha256,
  toArrayBuffer,
  bufferToHex,
  getSubtleCrypto,
} from '../app/core/security/evidence-crypto';
import { LocalProvider } from '../app/core/providers/local-provider';
import { authenticate } from '../app/core/auth/local-auth-service';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

async function assertRejects(
  fn: () => Promise<unknown>,
  expectedErrorType: typeof Error,
  expectedPattern: RegExp | string,
  msg: string
) {
  try {
    await fn();
    console.error(`❌ ASSERTION FAILED: Expected rejection, but function resolved: ${msg}`);
    process.exit(1);
  } catch (err: any) {
    const isInstance = err instanceof expectedErrorType;
    const matches = typeof expectedPattern === 'string'
      ? err?.message?.includes(expectedPattern)
      : expectedPattern.test(err?.message || '');
    if (!isInstance || !matches) {
      console.error(`❌ ASSERTION FAILED: ${msg}. Expected ${expectedErrorType.name} with pattern "${expectedPattern}", got:`, err);
      process.exit(1);
    }
    console.log(`  ✓ ${msg}`);
  }
}

function assertThrows(
  fn: () => unknown,
  expectedErrorType: typeof Error,
  expectedPattern: RegExp | string,
  msg: string
) {
  try {
    fn();
    console.error(`❌ ASSERTION FAILED: Expected throw, but function returned: ${msg}`);
    process.exit(1);
  } catch (err: any) {
    const isInstance = err instanceof expectedErrorType;
    const matches = typeof expectedPattern === 'string'
      ? err?.message?.includes(expectedPattern)
      : expectedPattern.test(err?.message || '');
    if (!isInstance || !matches) {
      console.error(`❌ ASSERTION FAILED: ${msg}. Expected ${expectedErrorType.name} with pattern "${expectedPattern}", got:`, err);
      process.exit(1);
    }
    console.log(`  ✓ ${msg}`);
  }
}

// ─── Setup Isolated In-Memory Storage ───────────────────────────
const memoryStores = new Map<string, Map<string, any>>();
function getStore(name: string) {
  if (!memoryStores.has(name)) memoryStores.set(name, new Map());
  return memoryStores.get(name)!;
}
function createReq(result: any) {
  const req: any = { result, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    if (req.onsuccess) req.onsuccess({ target: req });
  });
  return req;
}

(globalThis as any).indexedDB = {
  open: (_dbName: string, _version: number) => {
    const dbInstance: any = {
      objectStoreNames: { contains: (name: string) => memoryStores.has(name) },
      createObjectStore: (name: string) => {
        getStore(name);
        return { createIndex: () => {}, indexNames: { contains: () => true } };
      },
      transaction: (storeNames: string | string[], mode: string) => {
        const txObj: any = {
          objectStore: (s: string) => {
            const st = getStore(s);
            return {
              getAll: () => createReq(Array.from(st.values())),
              get: (key: string) => createReq(st.get(key)),
              put: (val: any) => {
                const key = val.id ?? val.key ?? `auto_${Math.random()}`;
                st.set(key, val);
                return createReq(key);
              },
              delete: (key: string) => {
                st.delete(key);
                return createReq(undefined);
              },
              clear: () => {
                st.clear();
                return createReq(undefined);
              },
            };
          },
          oncomplete: null,
          onerror: null,
          onabort: null,
        };
        queueMicrotask(() => {
          if (txObj.oncomplete) txObj.oncomplete();
        });
        return txObj;
      },
      close: () => {},
    };

    const req: any = {
      result: dbInstance,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  },
};

async function runSuite() {
  console.log('====================================================');
  console.log(' BATCH 3 — EVIDENCE HASHING VERIFICATION SUITE');
  console.log('====================================================\n');

  // ─── 1. Known SHA-256 Test Vectors ──────────────────────────────
  console.log('1. Known SHA-256 Vectors (NIST / RFC 6234 Standards & Seed Hashes):');

  // Vector 1: Empty string / 0 bytes
  const emptyHash = await computeStringSha256('');
  assert(
    emptyHash === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'Empty input matches standard SHA-256 (e3b0c44...)'
  );

  const emptyBufferHash = await computeSha256(new ArrayBuffer(0));
  assert(
    emptyBufferHash === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'Empty ArrayBuffer matches standard SHA-256'
  );

  // Vector 2: "abc"
  const abcHash = await computeStringSha256('abc');
  assert(
    abcHash === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    '"abc" matches RFC 6234 standard vector (ba7816...)'
  );

  // Vector 3: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
  const multiBlockHash = await computeStringSha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq');
  assert(
    multiBlockHash === '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    'Multi-block string matches RFC 6234 vector (248d6a...)'
  );

  // Vector 4: "The quick brown fox jumps over the lazy dog"
  const foxHash = await computeStringSha256('The quick brown fox jumps over the lazy dog');
  assert(
    foxHash === 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    '"The quick brown fox..." matches NIST vector (d7a8fb...)'
  );

  // Vector 5: Seed text note from evd-blacktide-003
  const seedText = 'Volatile memory triage of FINWS-027 verified injected thread in spoolsv.exe originating from powershell.exe (PID 4828). Outbound connection handles to 198.51.100.45:443 were active prior to network containment.';
  const seedTextHash = await computeStringSha256(seedText);
  assert(
    seedTextHash === '20f5769d771ebca2335a2408655c8a778fa037a23bb0cb0cffe47c6d51d5d6a2',
    'EVD-000003 text note payload matches authentic seed hash (20f576...)'
  );

  // Vector 6: ThreatLenX test payload
  const platformText = 'ThreatLenX Security Platform';
  const platformHash = await computeStringSha256(platformText);
  assert(
    platformHash === '8e2354c1fe2cee0e6a0418010bb259b23e3fa50ab41e90c2f4a56093cdd14161',
    'Custom verification payload matches verified Web Crypto SHA-256 (8e2354...)'
  );

  // ─── 2. Supported Payload Formats ────────────────────────────────
  console.log('\n2. Supported Binary & Persisted Payload Formats:');

  // ArrayBuffer
  const rawBuf = new TextEncoder().encode('abc').buffer;
  const hashFromBuf = await computeSha256(rawBuf);
  assert(hashFromBuf === abcHash, 'Native ArrayBuffer hashes identically to string');

  // Uint8Array
  const u8Arr = new TextEncoder().encode('abc');
  const hashFromU8 = await computeSha256(u8Arr);
  assert(hashFromU8 === abcHash, 'Uint8Array hashes identically to string');

  // TypedArray with offset and length slice
  const padded = new Uint8Array([99, 99, 97, 98, 99, 88, 88]); // "abc" at offset 2, length 3
  const viewSlice = new Uint8Array(padded.buffer, 2, 3);
  const hashFromSlice = await computeSha256(viewSlice);
  assert(hashFromSlice === abcHash, 'Uint8Array slice with byteOffset & byteLength hashes correctly');

  // Valid raw byte array (number[])
  const byteNumbers = [97, 98, 99]; // 'a', 'b', 'c'
  const hashFromNumbers = await computeSha256(byteNumbers);
  assert(hashFromNumbers === abcHash, 'Valid byte array [97, 98, 99] hashes correctly');

  // Serialized Buffer object: { type: 'Buffer', data: [97, 98, 99] }
  const serializedBuffer = { type: 'Buffer', data: [97, 98, 99] };
  const hashFromSerialized = await computeSha256(serializedBuffer);
  assert(hashFromSerialized === abcHash, 'Serialized Buffer object { type: "Buffer", data: [...] } hashes correctly');

  // Storage blob wrapper object: { data: Uint8Array }
  const storageBlobWrap = { data: new Uint8Array([97, 98, 99]) };
  const hashFromBlobWrap = await computeSha256(storageBlobWrap);
  assert(hashFromBlobWrap === abcHash, 'Storage blob wrapper { data: Uint8Array } hashes correctly');

  // Storage blob wrapper object with ArrayBuffer
  const storageBlobBuf = { data: new TextEncoder().encode('abc').buffer };
  const hashFromBlobBuf = await computeSha256(storageBlobBuf);
  assert(hashFromBlobBuf === abcHash, 'Storage blob wrapper { data: ArrayBuffer } hashes correctly');

  // Storage blob wrapper object with byte array
  const storageBlobNums = { data: [97, 98, 99] };
  const hashFromBlobNums = await computeSha256(storageBlobNums);
  assert(hashFromBlobNums === abcHash, 'Storage blob wrapper { data: number[] } hashes correctly');

  // ─── 3. Strict Rejection of Malformed Inputs ────────────────────
  console.log('\n3. Strict Rejection of Malformed Inputs (No Silent Coercion):');

  // Null and undefined
  assertThrows(
    () => toArrayBuffer(null),
    TypeError,
    /Expected binary data, received null or undefined/,
    'toArrayBuffer(null) throws TypeError'
  );

  assertThrows(
    () => toArrayBuffer(undefined),
    TypeError,
    /Expected binary data, received null or undefined/,
    'toArrayBuffer(undefined) throws TypeError'
  );

  await assertRejects(
    () => computeSha256(null),
    TypeError,
    /Expected binary data, received null or undefined/,
    'computeSha256(null) rejects with TypeError'
  );

  // String passed directly to computeSha256 (must guide caller to computeStringSha256)
  assertThrows(
    () => toArrayBuffer('not binary'),
    TypeError,
    /Use computeStringSha256 for text payloads/,
    'toArrayBuffer(string) throws TypeError pointing to computeStringSha256'
  );

  await assertRejects(
    () => computeSha256('not binary'),
    TypeError,
    /Use computeStringSha256 for text payloads/,
    'computeSha256(string) rejects with TypeError'
  );

  // Non-string passed to computeStringSha256
  await assertRejects(
    () => computeStringSha256(null as any),
    TypeError,
    /Expected string, received null/,
    'computeStringSha256(null) rejects with TypeError'
  );

  await assertRejects(
    () => computeStringSha256(12345 as any),
    TypeError,
    /Expected string, received number/,
    'computeStringSha256(number) rejects with TypeError'
  );

  await assertRejects(
    () => computeStringSha256({ text: 'abc' } as any),
    TypeError,
    /Expected string, received object/,
    'computeStringSha256(object) rejects with TypeError'
  );

  // Primitive non-binary types
  assertThrows(
    () => toArrayBuffer(12345),
    TypeError,
    /Unsupported type "number"/,
    'toArrayBuffer(number) throws TypeError'
  );

  assertThrows(
    () => toArrayBuffer(true),
    TypeError,
    /Unsupported type "boolean"/,
    'toArrayBuffer(boolean) throws TypeError'
  );

  // Arbitrary malformed objects (previously silently coerced to bytes via Object.values)
  assertThrows(
    () => toArrayBuffer({ foo: 'bar', age: 42 }),
    TypeError,
    /Malformed binary payload object/,
    'toArrayBuffer({ foo: "bar" }) throws TypeError instead of silently coercing'
  );

  assertThrows(
    () => toArrayBuffer({}),
    TypeError,
    /Malformed binary payload object/,
    'toArrayBuffer({}) throws TypeError'
  );

  await assertRejects(
    () => computeSha256({ corruptedPayload: true, filename: 'test.bin' }),
    TypeError,
    /Malformed binary payload object/,
    'computeSha256(arbitrary object) rejects with TypeError'
  );

  // Arrays containing non-byte values
  assertThrows(
    () => toArrayBuffer(['hello', 'world']),
    TypeError,
    /Array must contain only valid byte values/,
    'toArrayBuffer(["hello"]) throws TypeError'
  );

  assertThrows(
    () => toArrayBuffer([-1, 50, 100]),
    TypeError,
    /Array must contain only valid byte values/,
    'toArrayBuffer([-1]) throws TypeError for negative byte'
  );

  assertThrows(
    () => toArrayBuffer([0, 100, 256]),
    TypeError,
    /Array must contain only valid byte values/,
    'toArrayBuffer([256]) throws TypeError for byte > 255'
  );

  assertThrows(
    () => toArrayBuffer([1.5, 2.7]),
    TypeError,
    /Array must contain only valid byte values/,
    'toArrayBuffer([1.5]) throws TypeError for non-integer'
  );

  // Malformed serialized buffer structures
  assertThrows(
    () => toArrayBuffer({ type: 'Buffer', data: 'not an array' }),
    TypeError,
    /Wrapped data property must be an ArrayBuffer, TypedArray, or byte array/,
    'toArrayBuffer with invalid Buffer.data throws TypeError'
  );

  assertThrows(
    () => toArrayBuffer({ type: 'Buffer', data: [300, 400] }),
    TypeError,
    /Serialized Buffer data must contain only valid byte values/,
    'toArrayBuffer with out-of-range Buffer bytes throws TypeError'
  );

  // Malformed blob wrappers
  assertThrows(
    () => toArrayBuffer({ data: 'invalid data string' }),
    TypeError,
    /Wrapped data property must be an ArrayBuffer, TypedArray, or byte array/,
    'toArrayBuffer with string data property throws TypeError'
  );

  assertThrows(
    () => toArrayBuffer({ data: { nested: 'not valid' } }),
    TypeError,
    /Wrapped data property must be an ArrayBuffer, TypedArray, or byte array/,
    'toArrayBuffer with invalid nested data throws TypeError'
  );

  // ─── 4. Unavailable Web Crypto Handling ─────────────────────────
  console.log('\n4. Unavailable Web Crypto Context Error Handling:');

  const originalCrypto = globalThis.crypto;
  try {
    // Simulate unsupported context by removing crypto.subtle
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: undefined },
      configurable: true,
      writable: true,
    });

    assertThrows(
      () => getSubtleCrypto(),
      Error,
      /Unsupported context: Web Crypto API \(crypto\.subtle\) is not available/,
      'getSubtleCrypto throws clear unsupported-context error when subtle is missing'
    );

    await assertRejects(
      () => computeSha256(new Uint8Array([1, 2, 3])),
      Error,
      /Unsupported context: Web Crypto API \(crypto\.subtle\) is not available/,
      'computeSha256 rejects with unsupported-context error when Web Crypto is unavailable'
    );

    await assertRejects(
      () => computeStringSha256('test'),
      Error,
      /Unsupported context: Web Crypto API \(crypto\.subtle\) is not available/,
      'computeStringSha256 rejects with unsupported-context error when Web Crypto is unavailable'
    );

    // Simulate complete absence of global crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    assertThrows(
      () => getSubtleCrypto(),
      Error,
      /Unsupported context: Web Crypto API \(crypto\.subtle\) is not available/,
      'getSubtleCrypto throws when globalThis.crypto is undefined'
    );
  } finally {
    // Restore original global crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  }

  // Confirm Web Crypto is restored
  const restoredHash = await computeStringSha256('abc');
  assert(restoredHash === abcHash, 'Web Crypto fully restored after mock removal test');

  // ─── 5. Isolated Storage & Evidence Integrity Persistence ───────
  console.log('\n5. Isolated Storage & Evidence Integrity Persistence:');

  const provider = new LocalProvider();
  await provider.initialize();

  // Authenticate valid analyst session
  authenticate({ username: 'sarah.chen' });

  // Verify baseline seeded evidence items retain authentic hashes
  const evidenceList = await provider.getEvidence();
  assert(evidenceList.length >= 3, `Isolated store contains seeded evidence (found ${evidenceList.length})`);

  const evd1 = evidenceList.find((e) => e.evidenceNumber === 'EVD-000001');
  assert(Boolean(evd1), 'EVD-000001 present');
  assert(
    evd1?.integrity.hash === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'EVD-000001 preserves authentic empty hash'
  );

  const evd2 = evidenceList.find((e) => e.evidenceNumber === 'EVD-000002');
  assert(Boolean(evd2), 'EVD-000002 present');
  assert(
    evd2?.integrity.hash === '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
    'EVD-000002 preserves authentic hunt reference hash'
  );

  const evd3 = evidenceList.find((e) => e.evidenceNumber === 'EVD-000003');
  assert(Boolean(evd3), 'EVD-000003 present');
  assert(
    evd3?.integrity.hash === '20f5769d771ebca2335a2408655c8a778fa037a23bb0cb0cffe47c6d51d5d6a2',
    'EVD-000003 preserves authentic text note hash'
  );

  // Run integrity verification on seed text evidence EVD-000003
  const vResult3 = await provider.verifyEvidenceIntegrity(evd3!.id, 'analyst1', 'L2_ANALYST');
  assert(vResult3.verified === true, 'EVD-000003 integrity verification verified = true');
  assert(vResult3.computedHash === evd3!.integrity.hash, 'Computed hash matches stored hash');
  assert(vResult3.message.includes('verified against text payload'), 'Verification message confirms text payload match');

  // Collect new file evidence with binary payload in isolated storage
  const fileContent = new TextEncoder().encode('CRITICAL FORENSIC EVIDENCE PAYLOAD');
  const expectedFileHash = await computeSha256(fileContent);

  const newEvd = await provider.createEvidence(
    {
      caseId: 'case-blacktide-001',
      type: 'FILE',
      title: 'Isolated Network Packet Capture',
      description: 'Extracted pcap buffer from host network adapter',
      sourceType: 'ASSET',
      sourceId: 'asset-001',
      fileName: 'capture.pcap',
      mimeType: 'application/vnd.tcpdump.pcap',
      fileBytes: fileContent.buffer,
    },
    'sarah.chen',
    'SOC_MANAGER'
  );

  assert(Boolean(newEvd), 'Collected new file evidence');
  assert(newEvd.integrity.hash === expectedFileHash, 'New evidence hash matches Web Crypto computed hash');
  assert(newEvd.storageReference !== undefined, 'Storage reference created for binary payload');

  // Verify the new binary file evidence
  const vResultNew = await provider.verifyEvidenceIntegrity(newEvd.id, 'sarah.chen', 'SOC_MANAGER');
  assert(vResultNew.verified === true, 'New file evidence verification verified = true');
  assert(vResultNew.computedHash === expectedFileHash, 'New file computed hash matches expected hash');

  // Verify tampering detection without overwriting stored hash
  // Intentionally tamper with internal stored textContent in provider
  const internalEvd3 = (provider as any)._evidence.find((e: any) => e.id === evd3!.id);
  internalEvd3.textContent = 'Tampered text content by attacker';
  const vResultTampered = await provider.verifyEvidenceIntegrity(evd3!.id, 'sarah.chen', 'SOC_MANAGER');
  assert(vResultTampered.verified === false, 'Tampered evidence verification verified = false (MISMATCH)');
  assert(vResultTampered.message.includes('INTEGRITY MISMATCH'), 'Message indicates integrity mismatch');
  assert(internalEvd3.integrity.hash === '20f5769d771ebca2335a2408655c8a778fa037a23bb0cb0cffe47c6d51d5d6a2', 'Original stored hash is strictly preserved (never overwritten on mismatch)');

  // Verify chain of custody records
  const custodyHistory = await provider.getEvidenceCustody(evd3!.id);
  assert(custodyHistory.length >= 2, `Chain of custody recorded verification events (found ${custodyHistory.length})`);
  const lastCustody = custodyHistory[custodyHistory.length - 1];
  assert(lastCustody.action === 'INTEGRITY_VERIFIED', 'Last custody entry is INTEGRITY_VERIFIED');

  console.log('\n====================================================');
  console.log('✅ ALL BATCH 3 EVIDENCE HASHING TESTS PASSED');
  console.log('====================================================');
}

runSuite().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
