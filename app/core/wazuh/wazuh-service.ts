/**
 * app/core/wazuh/wazuh-service.ts
 *
 * Dedicated Wazuh Integration Service.
 * Implements token-based authentication against the Wazuh Manager REST API (port 55000),
 * automatic token refreshing, retrieval of alerts & agents with MITRE ATT&CK extraction,
 * and high-fidelity fallback when the Wazuh API is offline or unconfigured.
 */

import { getWazuhConfig, isWazuhConfigured, type WazuhConfig } from './wazuh-config';
import type {
  NormalizedAlert,
  WazuhAgent,
  WazuhAgentStatusSummary,
  WazuhApiResponse,
  WazuhAuthResponse,
  WazuhConnectionStatus,
  WazuhRawAlert,
} from './wazuh-types';
import {
  MOCK_NORMALIZED_ALERTS,
  MOCK_WAZUH_AGENTS,
  MOCK_WAZUH_AGENT_SUMMARY,
} from './wazuh-mock-data';
import {
  normalizeWazuhAgent,
  normalizeWazuhAlert,
  toCanonicalSocAlert,
} from './wazuh-normalizer';
import type { Alert } from '../models/detection';

export class WazuhService {
  private config: WazuhConfig;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private lastStatus: WazuhConnectionStatus = {
    isConnected: false,
    mode: 'MOCK_FALLBACK',
    apiUrl: '',
    authConfigured: false,
    lastChecked: new Date().toISOString(),
  };

  constructor(config?: WazuhConfig) {
    this.config = config || getWazuhConfig();
    this.lastStatus.apiUrl = this.config.apiUrl;
    this.lastStatus.authConfigured = isWazuhConfigured(this.config);

    // Disable TLS rejection for local self-signed dev certificates if explicitly configured
    if (!this.config.verifySsl && typeof process !== 'undefined' && process.env) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  /**
   * Re-evaluates configuration (useful after runtime env changes).
   */
  public reloadConfig(): void {
    this.config = getWazuhConfig();
    this.token = null;
    this.tokenExpiresAt = 0;
    this.lastStatus.apiUrl = this.config.apiUrl;
    this.lastStatus.authConfigured = isWazuhConfigured(this.config);
  }

  /**
   * Acquires or reuses a JWT authentication token from POST /security/user/authenticate.
   */
  private async authenticate(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - 60000) {
      return this.token;
    }

    if (!isWazuhConfigured(this.config)) {
      throw new Error('Wazuh credentials not configured (WAZUH_API_USER / WAZUH_API_PASSWORD missing)');
    }

    const authUrl = `${this.config.apiUrl}/security/user/authenticate`;
    const basicAuth = Buffer.from(
      `${this.config.apiUser}:${this.config.apiPassword}`
    ).toString('base64');

    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Wazuh authentication failed: HTTP ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as WazuhAuthResponse;
    const token = json?.data?.token;
    if (!token) {
      throw new Error('Wazuh API responded without a valid JWT token');
    }

    this.token = token;
    // Wazuh JWT tokens typically expire in 900s (15 min); cache for 14 min
    this.tokenExpiresAt = now + 14 * 60 * 1000;
    return token;
  }

  /**
   * Tests connectivity and authentication to the Wazuh API.
   */
  public async testConnection(): Promise<WazuhConnectionStatus> {
    const now = new Date().toISOString();
    const startTime = performance.now();

    if (!isWazuhConfigured(this.config)) {
      this.lastStatus = {
        isConnected: false,
        mode: 'MOCK_FALLBACK',
        apiUrl: this.config.apiUrl,
        authConfigured: false,
        lastChecked: now,
        error: 'Credentials not configured (using mock fallback data)',
      };
      return this.lastStatus;
    }

    try {
      const token = await this.authenticate();
      const statusRes = await fetch(`${this.config.apiUrl}/manager/info`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!statusRes.ok) {
        throw new Error(`Wazuh manager returned HTTP ${statusRes.status}`);
      }

      const infoJson = (await statusRes.json()) as any;
      const latencyMs = Math.round(performance.now() - startTime);

      this.lastStatus = {
        isConnected: true,
        mode: 'LIVE',
        apiUrl: this.config.apiUrl,
        authConfigured: true,
        version: infoJson?.data?.affected_items?.[0]?.version || 'Wazuh 4.x',
        latencyMs,
        lastChecked: now,
      };
      return this.lastStatus;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.lastStatus = {
        isConnected: false,
        mode: 'MOCK_FALLBACK',
        apiUrl: this.config.apiUrl,
        authConfigured: true,
        lastChecked: now,
        error: `Wazuh unreachable: ${errorMsg} (switched to mock fallback)`,
      };
      return this.lastStatus;
    }
  }

  /**
   * Retrieves alerts from Wazuh and normalizes them into NormalizedAlert[].
   * Automatically falls back to mock alerts if live API is unavailable.
   */
  public async getNormalizedAlerts(limit = 50): Promise<{
    source: 'LIVE' | 'MOCK_FALLBACK';
    alerts: NormalizedAlert[];
    error?: string;
  }> {
    if (!isWazuhConfigured(this.config)) {
      return {
        source: 'MOCK_FALLBACK',
        alerts: MOCK_NORMALIZED_ALERTS.slice(0, limit),
      };
    }

    try {
      const token = await this.authenticate();

      // Query alerts from manager API
      const url = `${this.config.apiUrl}/alerts?limit=${limit}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from /alerts`);
      }

      const json = (await response.json()) as WazuhApiResponse<WazuhRawAlert>;
      const rawAlerts = json?.data?.affected_items || [];

      if (rawAlerts.length === 0) {
        // If the live server has 0 active alerts, return empty array with LIVE source
        return {
          source: 'LIVE',
          alerts: [],
        };
      }

      const normalized = rawAlerts.map(normalizeWazuhAlert);
      return {
        source: 'LIVE',
        alerts: normalized,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        source: 'MOCK_FALLBACK',
        alerts: MOCK_NORMALIZED_ALERTS.slice(0, limit),
        error: errorMsg,
      };
    }
  }

  /**
   * Retrieves Wazuh agents and status summary.
   * Automatically falls back to mock agents if live API is unavailable.
   */
  public async getAgents(limit = 100): Promise<{
    source: 'LIVE' | 'MOCK_FALLBACK';
    agents: WazuhAgent[];
    summary: WazuhAgentStatusSummary;
    error?: string;
  }> {
    if (!isWazuhConfigured(this.config)) {
      return {
        source: 'MOCK_FALLBACK',
        agents: MOCK_WAZUH_AGENTS.slice(0, limit),
        summary: MOCK_WAZUH_AGENT_SUMMARY,
      };
    }

    try {
      const token = await this.authenticate();

      const [agentsRes, summaryRes] = await Promise.all([
        fetch(`${this.config.apiUrl}/agents?limit=${limit}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(this.config.timeoutMs),
        }),
        fetch(`${this.config.apiUrl}/agents/summary/status`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(this.config.timeoutMs),
        }),
      ]);

      if (!agentsRes.ok) {
        throw new Error(`HTTP ${agentsRes.status} from /agents`);
      }

      const agentsJson = (await agentsRes.json()) as WazuhApiResponse<any>;
      const rawAgents = agentsJson?.data?.affected_items || [];
      const agents = rawAgents.map(normalizeWazuhAgent);

      let summary: WazuhAgentStatusSummary = {
        total: agents.length,
        active: agents.filter((a) => a.status === 'active').length,
        disconnected: agents.filter((a) => a.status === 'disconnected').length,
        never_connected: agents.filter((a) => a.status === 'never_connected').length,
        pending: agents.filter((a) => a.status === 'pending').length,
      };

      if (summaryRes.ok) {
        const sumJson = (await summaryRes.json()) as any;
        const data = sumJson?.data;
        if (data) {
          summary = {
            total: data.total || summary.total,
            active: data.active || summary.active,
            disconnected: data.disconnected || summary.disconnected,
            never_connected: data.never_connected || summary.never_connected,
            pending: data.pending || summary.pending,
          };
        }
      }

      return {
        source: 'LIVE',
        agents,
        summary,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        source: 'MOCK_FALLBACK',
        agents: MOCK_WAZUH_AGENTS.slice(0, limit),
        summary: MOCK_WAZUH_AGENT_SUMMARY,
        error: errorMsg,
      };
    }
  }

  /**
   * Returns alerts mapped to canonical SOC Alert[] format for seamless ingestion into securityService.
   */
  public async getCanonicalSocAlerts(limit = 50): Promise<Alert[]> {
    const { alerts } = await this.getNormalizedAlerts(limit);
    return alerts.map(toCanonicalSocAlert);
  }

  /**
   * Returns current cached connection status.
   */
  public getStatus(): WazuhConnectionStatus {
    return this.lastStatus;
  }
}

/**
 * Singleton instance of the WazuhService.
 */
export const wazuhService = new WazuhService();
