/**
 * data-redaction.ts
 *
 * Data redaction boundary for Step 14.
 * Neutralizes sensitive tokens, passwords, bearer credentials, and private keys
 * before any telemetry or security context leaves the local boundary.
 */

const SENSITIVE_PATTERNS = [
  /password\s*[:=]\s*['"]?[^\s'";]+['"]?/gi,
  /passwd\s*[:=]\s*['"]?[^\s'";]+['"]?/gi,
  /bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi,
  /api[_\-]?key\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{16,}['"]?/gi,
  /secret\s*[:=]\s*['"]?[^\s'";]+['"]?/gi,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g,
  /authorization\s*[:=]\s*['"]?[^\s'";]+['"]?/gi,
];

/**
 * Redacts known sensitive patterns from an arbitrary string.
 */
export function redactString(str: string): string {
  if (!str) return '';
  let result = str;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED_SECRET]');
  }
  return result;
}

/**
 * Deeply redacts sensitive keys and values from a JSON-serializable object.
 */
export function redactSensitiveTelemetry<T>(data: T): T {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return redactString(data) as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveTelemetry(item)) as unknown as T;
  }

  if (typeof data === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('privatekey') ||
        lowerKey.includes('apikey')
      ) {
        copy[key] = '[REDACTED_CREDENTIAL]';
      } else {
        copy[key] = redactSensitiveTelemetry(value);
      }
    }
    return copy as T;
  }

  return data;
}
