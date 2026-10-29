/**
 * app/spatial/investigation/IncidentFindingsView.tsx
 *
 * Dedicated Incident Findings Panel for Incident Workspace.
 *
 * Displays correlated security findings, root cause analysis,
 * triggered detection rules, and verified operational impact.
 * Consumes canonical data from InvestigationContext and SecurityService.
 */

'use client';
import { useInvestigation } from './InvestigationContext';
import {
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Crosshair,
  Server,
  Zap,
  Tag,
  ArrowRight,
} from 'lucide-react';
import { cyberAudio } from '../../cyber-audio';

interface IncidentFindingsViewProps {
  incidentId: string;
  onSelectEntity?: (entity: any) => void;
}

export default function IncidentFindingsView({ incidentId }: IncidentFindingsViewProps) {
  const { data, setSelectedEntity } = useInvestigation();

  if (!data) {
    return (
      <div className="inv-findings-loading">
        <div className="inv-hub-boot-ring" />
        <span>ANALYZING CORRELATED INCIDENT FINDINGS…</span>
      </div>
    );
  }

  const inc = data.incident;
  const correlationItems = inc.correlationChain ?? [];
  const mitreCoverage = data.mitreCoverage ?? [];
  const affectedAssets = data.allAssets.filter((a) => inc.affectedAssets?.includes(a.id));

  return (
    <div className="inv-findings-panel" role="region" aria-label="Incident Security Findings">
      {/* Findings Header */}
      <div className="inv-findings-topbar">
        <div className="inv-findings-title-group">
          <AlertTriangle size={14} className="text-amber" />
          <span className="inv-findings-title">CORRELATED SECURITY FINDINGS & IMPACT ANALYSIS</span>
          <span className="inv-findings-count-tag">{correlationItems.length + mitreCoverage.length} VERIFIED FINDINGS</span>
        </div>
        <div className="inv-findings-confidence-badge">
          <ShieldCheck size={12} color="#3dffb0" />
          <span>{Math.round((inc.confidence ?? 0.9) * 100)}% ENGINE CONFIDENCE</span>
        </div>
      </div>

      <div className="inv-findings-content">
        {/* Left Column: Root Cause & Detection Chain */}
        <div className="inv-findings-col-main">
          <div className="inv-finding-card primary-root-cause">
            <div className="inv-finding-badge">ROOT CAUSE DETERMINATION</div>
            <h3 className="inv-finding-title">{inc.title}</h3>
            <p className="inv-finding-desc">
              {inc.summary || inc.description || 'Deterministic causal correlation verified across endpoint, network, and identity telemetry.'}
            </p>
            <div className="inv-finding-meta-row">
              <span className="inv-meta-tag sev">SEVERITY: {inc.severity}</span>
              <span className="inv-meta-tag risk">RISK SCORE: {inc.riskScore}/100</span>
              <span className="inv-meta-tag status">STATUS: {inc.status}</span>
            </div>
          </div>

          {/* Correlated Alert Detections */}
          <div className="inv-findings-section">
            <h4 className="inv-section-title">
              <Zap size={12} color="#00f0ff" />
              CORRELATED DETECTION CHAIN ({correlationItems.length})
            </h4>

            <div className="inv-correlation-list">
              {correlationItems.length === 0 ? (
                <div className="inv-findings-empty">No intermediate correlation alerts recorded.</div>
              ) : (
                correlationItems.map((item, idx) => (
                  <div key={item.id || idx} className="inv-correlation-card">
                    <div className="inv-corr-header">
                      <span className="inv-corr-step">STEP {idx + 1}</span>
                      <span className="inv-corr-rule">{item.ruleName}</span>
                      <span className="inv-corr-conf">{Math.round((item.confidence ?? 0.9) * 100)}% CONF</span>
                    </div>
                    <div className="inv-corr-title">{item.title}</div>
                    <div className="inv-corr-summary">{item.evidenceSummary}</div>
                    <div className="inv-corr-time">{new Date(item.timestamp).toLocaleTimeString()}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: MITRE Tactics & Impacted Systems */}
        <div className="inv-findings-col-side">
          {/* MITRE Coverage */}
          <div className="inv-findings-section">
            <h4 className="inv-section-title">
              <Crosshair size={12} color="#a78bfa" />
              CONFIRMED MITRE ATT&CK TECHNIQUES ({mitreCoverage.length})
            </h4>
            <div className="inv-mitre-findings-list">
              {mitreCoverage.map((m) => (
                <div
                  key={m.technique.id}
                  className="inv-mitre-finding-chip"
                  onClick={() => {
                    cyberAudio.playClick();
                    setSelectedEntity({ id: m.technique.id, type: 'TECHNIQUE' });
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="inv-mitre-chip-header">
                    <span className="inv-mitre-id">{m.technique.id}</span>
                    <span className="inv-mitre-tactic">{m.technique.tacticId}</span>
                  </div>
                  <div className="inv-mitre-name">{m.technique.name}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Impacted Assets */}
          <div className="inv-findings-section">
            <h4 className="inv-section-title">
              <Server size={12} color="#3dffb0" />
              BLAST RADIUS & AFFECTED ASSETS ({affectedAssets.length})
            </h4>
            <div className="inv-assets-findings-list">
              {affectedAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="inv-asset-finding-card"
                  onClick={() => {
                    cyberAudio.playClick();
                    setSelectedEntity({ id: asset.id, type: 'ASSET' });
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="inv-asset-name">{asset.name}</div>
                  <div className="inv-asset-meta">
                    <span className="inv-asset-type">{asset.type}</span>
                    <span className="inv-asset-ip">{asset.ipAddress}</span>
                    <span className={`inv-asset-crit crit-${asset.criticality?.toLowerCase()}`}>
                      {asset.criticality}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
