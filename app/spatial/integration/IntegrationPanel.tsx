'use client';

import React, { useState, useEffect, useCallback } from 'react';
import './integration.css';
import { securityService } from '../../core/security-service';
import type {
  ConnectivityMode,
  ConnectivityState,
  SyncOperation,
  SyncConflict,
} from '../../core/models/integration';

interface IntegrationPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IntegrationPanel: React.FC<IntegrationPanelProps> = ({ isOpen, onClose }) => {
  const [state, setState] = useState<ConnectivityState | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'adapters' | 'queue' | 'conflicts' | 'simulator'>('overview');
  const [queue, setQueue] = useState<SyncOperation[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const refreshData = useCallback(async () => {
    try {
      const conn = await securityService.getConnectivityState();
      setState(conn);
      const q = await securityService.getSyncQueue();
      setQueue(q);
      const c = await securityService.getSyncConflicts();
      setConflicts(c);
    } catch (err: unknown) {
      console.warn('[IntegrationPanel] Error refreshing integration state:', err);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    refreshData();

    const unsubConn = securityService.subscribe('CONNECTIVITY_CHANGED', refreshData);
    const unsubSync = securityService.subscribe('SYNC_COMPLETED', refreshData);
    const unsubConflict = securityService.subscribe('SYNC_CONFLICT_DETECTED', refreshData);

    return () => {
      unsubConn();
      unsubSync();
      unsubConflict();
    };
  }, [isOpen, refreshData]);

  const handleModeSwitch = async (targetMode: ConnectivityMode) => {
    try {
      setStatusMessage(`Switching to ${targetMode} mode...`);
      await securityService.setConnectivityMode(targetMode);
      setStatusMessage(`Operating mode set to ${targetMode}`);
      setTimeout(() => setStatusMessage(null), 3000);
      await refreshData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Error: ${msg}`);
    }
  };

  const handleResolveConflict = async (conflictId: string, resolution: 'LOCAL_WINS' | 'REMOTE_WINS') => {
    try {
      await securityService.resolveSyncConflict(conflictId, resolution);
      setStatusMessage(`Conflict resolved: ${resolution}`);
      setTimeout(() => setStatusMessage(null), 3000);
      await refreshData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Error: ${msg}`);
    }
  };

  const handleSimulateExternalEvent = async () => {
    try {
      setIsSimulating(true);
      setStatusMessage('Ingesting external telemetry from Splunk SIEM...');
      const rawEvent = {
        event_id: `ext-siem-${Date.now()}`,
        time: new Date().toISOString(),
        host: 'srv-finance-db.internal',
        source_category: 'SECURITY_ALERT',
        log_level: 'CRITICAL',
        summary: 'External SIEM Alert: Unauthorized Mimikatz execution and LSASS memory dump',
        asset: 'srv-finance-db',
        user: 'svc_backup',
        ip: '10.0.12.88',
        technique: 'T1003.001',
      };
      const res = await securityService.ingestExternalEvent(rawEvent, 'Splunk Enterprise SIEM');
      setStatusMessage(
        res.success
          ? `Normalized & Ingested! Event ID: ${res.event?.id}`
          : `Failed: ${res.error || 'Unknown error'}`
      );
      setTimeout(() => setStatusMessage(null), 4000);
      await refreshData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Ingest failed: ${msg}`);
    } finally {
      setIsSimulating(false);
    }
  };

  if (!isOpen) return null;

  const isConnected = state?.mode === 'CONNECTED';

  return (
    <aside className={`integration-drawer ${isOpen ? 'open' : ''}`} aria-label="Integration Architecture Drawer">
      {/* Header */}
      <header className="integration-header">
        <div className="integration-title-group">
          <div className="integration-icon">I</div>
          <div>
            <h2 className="integration-title">INTEGRATION SEAM & SYNC ARCHITECTURE</h2>
            <p className="integration-subtitle">Step 14 &bull; Offline-First &bull; Provider-Agnostic SOC</p>
          </div>
        </div>
        <button
          type="button"
          className="integration-close-btn"
          onClick={onClose}
          aria-label="Close integration panel"
        >
          ESC
        </button>
      </header>

      {/* Connectivity Status Ribbon */}
      <section className="connectivity-ribbon">
        <div className={`status-pill ${isConnected ? 'connected' : 'offline'}`}>
          <span className={`status-dot ${isConnected ? 'connected' : 'offline'}`} />
          <span>{state ? `${state.mode} (${state.status})` : 'CHECKING...'}</span>
        </div>

        <div className="mode-toggle-group">
          <button
            type="button"
            className={`mode-btn ${!isConnected ? 'active' : ''}`}
            onClick={() => handleModeSwitch('OFFLINE')}
          >
            OFFLINE
          </button>
          <button
            type="button"
            className={`mode-btn ${isConnected ? 'active' : ''}`}
            onClick={() => handleModeSwitch('CONNECTED')}
          >
            CONNECTED
          </button>
        </div>
      </section>

      {/* Navigation Tabs */}
      <nav className="integration-tabs">
        <button
          type="button"
          className={`int-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          OVERVIEW
        </button>
        <button
          type="button"
          className={`int-tab ${activeTab === 'adapters' ? 'active' : ''}`}
          onClick={() => setActiveTab('adapters')}
        >
          ADAPTERS
        </button>
        <button
          type="button"
          className={`int-tab ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          OUTBOX QUEUE
          {queue.length > 0 && <span className="badge-counter">{queue.length}</span>}
        </button>
        <button
          type="button"
          className={`int-tab ${activeTab === 'conflicts' ? 'active' : ''}`}
          onClick={() => setActiveTab('conflicts')}
        >
          CONFLICTS
          {conflicts.length > 0 && <span className="badge-counter">{conflicts.length}</span>}
        </button>
        <button
          type="button"
          className={`int-tab ${activeTab === 'simulator' ? 'active' : ''}`}
          onClick={() => setActiveTab('simulator')}
        >
          INGEST LAB
        </button>
      </nav>

      {/* Status Notice */}
      {statusMessage && (
        <div style={{ background: 'rgba(0, 240, 255, 0.12)', borderBottom: '1px solid rgba(0, 240, 255, 0.3)', padding: '8px 22px', fontSize: '11px', color: '#38bdf8' }}>
          {statusMessage}
        </div>
      )}

      {/* Scrollable Content */}
      <div className="integration-body">
        {activeTab === 'overview' && (
          <>
            <div className="section-box">
              <h3 className="section-title">SYSTEM CONNECTIVITY STATE</h3>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-label">Operating Mode</div>
                  <div className="stat-value">{state?.mode || 'OFFLINE'}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Airgap Guard</div>
                  <div className="stat-value" style={{ color: state?.isAirgapped ? '#34d399' : '#38bdf8' }}>
                    {state?.isAirgapped ? 'AIRGAPPED' : 'NETWORKED'}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Active Provider</div>
                  <div className="stat-value" style={{ fontSize: '12px' }}>{state?.activeProviderId || 'LOCAL_PROVIDER'}</div>
                </div>
              </div>
            </div>

            <div className="section-box">
              <h3 className="section-title">SYNCHRONIZATION TELEMETRY</h3>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-label">Pending Outbox</div>
                  <div className="stat-value">{state?.pendingChangesCount || 0}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Active Conflicts</div>
                  <div className="stat-value" style={{ color: (state?.activeConflictsCount || 0) > 0 ? '#f87171' : '#f1f5f9' }}>
                    {state?.activeConflictsCount || 0}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Sync Latency</div>
                  <div className="stat-value">{state?.latencyMs ? `${state.latencyMs}ms` : '0ms (LOCAL)'}</div>
                </div>
              </div>
            </div>

            <div className="section-box">
              <h3 className="section-title">INTEGRATION SEAM PRINCIPLES</h3>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '11px', lineHeight: '1.6', color: '#94a3b8' }}>
                <li><strong style={{ color: '#e2e8f0' }}>Offline First:</strong> Zero network dependencies. The entire SOC runs 100% locally from IndexedDB.</li>
                <li><strong style={{ color: '#e2e8f0' }}>Local-First Writes:</strong> Incidents, cases, alerts, and rules persist to IndexedDB immediately before background sync.</li>
                <li><strong style={{ color: '#e2e8f0' }}>Data Redaction Boundary:</strong> Secrets, bearer tokens, and private keys are scrubbed before crossing integration seams.</li>
                <li><strong style={{ color: '#e2e8f0' }}>Controlled Execution:</strong> EDR host isolation and user suspension must pass through RBAC and human approval.</li>
              </ul>
            </div>
          </>
        )}

        {activeTab === 'adapters' && (
          <div className="section-box">
            <h3 className="section-title">REGISTERED INTEGRATION ADAPTERS</h3>
            <div className="adapters-list">
              <div className="adapter-row">
                <div>
                  <div className="adapter-name">SIEM Event Ingestion Stream</div>
                  <div className="adapter-type">Splunk / Syslog / CloudWatch &bull; Real-time Ingestion</div>
                </div>
                <span className="adapter-badge ready">READY</span>
              </div>
              <div className="adapter-row">
                <div>
                  <div className="adapter-name">EDR Host Agent Gateway</div>
                  <div className="adapter-type">CrowdStrike Falcon / Microsoft Defender &bull; Host Isolation</div>
                </div>
                <span className="adapter-badge ready">READY</span>
              </div>
              <div className="adapter-row">
                <div>
                  <div className="adapter-name">Enterprise Identity Provider</div>
                  <div className="adapter-type">Azure Active Directory / Okta &bull; Account Suspension</div>
                </div>
                <span className="adapter-badge ready">READY</span>
              </div>
              <div className="adapter-row">
                <div>
                  <div className="adapter-name">Threat Intelligence Feeds</div>
                  <div className="adapter-type">AlienVault OTX / VirusTotal &bull; IOC Reputation</div>
                </div>
                <span className="adapter-badge ready">READY</span>
              </div>
              <div className="adapter-row">
                <div>
                  <div className="adapter-name">Forensic Evidence Vault</div>
                  <div className="adapter-type">Immutable Object Store (S3 / Azure Blob) &bull; SHA-256 Custody</div>
                </div>
                <span className="adapter-badge ready">READY</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'queue' && (
          <div className="section-box">
            <h3 className="section-title">
              <span>LOCAL-FIRST OUTBOX QUEUE</span>
              <span style={{ fontSize: '10px', color: '#64748b' }}>{queue.length} PENDING MUTATIONS</span>
            </h3>
            {queue.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b', fontSize: '11px' }}>
                Queue is clear &bull; All local mutations committed and synchronized.
              </div>
            ) : (
              <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                {queue.map((op) => (
                  <div key={op.operationId} className="sync-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <strong style={{ color: '#38bdf8' }}>{op.operation} {op.entityType}</strong>
                      <span style={{ color: '#94a3b8' }}>ID: {op.entityId}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '10px' }}>
                      <span>Retries: {op.retryCount}</span>
                      <span>Queued: {new Date(op.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'conflicts' && (
          <div className="section-box">
            <h3 className="section-title">
              <span>DETERMINISTIC CONFLICT RESOLUTION</span>
              <span style={{ fontSize: '10px', color: '#f87171' }}>{conflicts.length} UNRESOLVED</span>
            </h3>
            {conflicts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b', fontSize: '11px' }}>
                No active conflicts detected &bull; Local and remote states are coherent.
              </div>
            ) : (
              conflicts.map((c) => (
                <div key={c.conflictId} className="conflict-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '11px' }}>
                    <span style={{ color: '#f87171' }}>Conflict on {c.entityType} ({c.entityId})</span>
                    <span style={{ color: '#94a3b8' }}>{new Date(c.detectedAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="conflict-diff">
                    <div>
                      <strong style={{ color: '#38bdf8' }}>LOCAL COPY</strong>
                      <pre style={{ margin: '4px 0 0 0', overflowX: 'hidden' }}>{JSON.stringify(c.localPayload, null, 2).slice(0, 140)}...</pre>
                    </div>
                    <div>
                      <strong style={{ color: '#34d399' }}>REMOTE COPY</strong>
                      <pre style={{ margin: '4px 0 0 0', overflowX: 'hidden' }}>{JSON.stringify(c.remotePayload, null, 2).slice(0, 140)}...</pre>
                    </div>
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <button
                      type="button"
                      className="action-btn-sm"
                      onClick={() => handleResolveConflict(c.conflictId, 'LOCAL_WINS')}
                    >
                      Keep Local (Analyst Override)
                    </button>
                    <button
                      type="button"
                      className="action-btn-sm action-btn-red"
                      onClick={() => handleResolveConflict(c.conflictId, 'REMOTE_WINS')}
                    >
                      Accept Remote
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'simulator' && (
          <div className="section-box">
            <h3 className="section-title">EXTERNAL EVENT INGESTION SIMULATOR</h3>
            <p style={{ fontSize: '11px', color: '#94a3b8', lineHeight: '1.5' }}>
              Test ingestion of external telemetry (Syslog/SIEM/CloudWatch). The telemetry will pass through:
            </p>
            <div style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '10px', borderRadius: '4px', fontSize: '10px', color: '#38bdf8', marginBottom: '14px' }}>
              External Event &rarr; Normalizer &rarr; Deduplication &rarr; SecurityEvent &rarr; Detection Engine &rarr; Alert Engine &rarr; Correlation
            </div>
            <button
              type="button"
              className="action-btn-sm"
              disabled={isSimulating}
              onClick={handleSimulateExternalEvent}
              style={{ padding: '8px 16px', fontSize: '11px' }}
            >
              {isSimulating ? 'Processing...' : 'Simulate External Splunk Alert'}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
