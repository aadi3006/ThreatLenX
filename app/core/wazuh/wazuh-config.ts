/**
 * app/core/wazuh/wazuh-config.ts
 *
 * Environment variable configuration for the Wazuh module.
 * Credentials are never hardcoded and are read dynamically from runtime environment.
 */

export interface WazuhConfig {
  apiUrl: string;
  apiUser: string;
  apiPassword: string;
  verifySsl: boolean;
  timeoutMs: number;
  mockFallbackEnabled: boolean;
}

/**
 * Reads configuration strictly from process.env with defensive fallbacks.
 */
export function getWazuhConfig(): WazuhConfig {
  const apiUrl = (process.env.WAZUH_API_URL || 'https://127.0.0.1:55000').replace(/\/+$/, '');
  const apiUser = process.env.WAZUH_API_USER || '';
  const apiPassword = process.env.WAZUH_API_PASSWORD || '';
  const verifySsl = process.env.WAZUH_VERIFY_SSL !== 'false' && process.env.WAZUH_VERIFY_SSL !== '0';
  const timeoutMs = parseInt(process.env.WAZUH_TIMEOUT_MS || '5000', 10) || 5000;
  const mockFallbackEnabled = process.env.WAZUH_MOCK_FALLBACK !== 'false';

  return {
    apiUrl,
    apiUser,
    apiPassword,
    verifySsl,
    timeoutMs,
    mockFallbackEnabled,
  };
}

/**
 * Checks whether minimum required credentials are configured to attempt a live Wazuh connection.
 */
export function isWazuhConfigured(config: WazuhConfig = getWazuhConfig()): boolean {
  return Boolean(config.apiUrl && config.apiUser && config.apiPassword);
}

/**
 * Sanitizes config for logs and UI status endpoints (strips password).
 */
export function getSanitizedWazuhConfig(config: WazuhConfig = getWazuhConfig()) {
  return {
    apiUrl: config.apiUrl,
    apiUser: config.apiUser ? `${config.apiUser.slice(0, 3)}***` : 'NOT_SET',
    hasPassword: Boolean(config.apiPassword),
    verifySsl: config.verifySsl,
    timeoutMs: config.timeoutMs,
    mockFallbackEnabled: config.mockFallbackEnabled,
    isConfigured: isWazuhConfigured(config),
  };
}
