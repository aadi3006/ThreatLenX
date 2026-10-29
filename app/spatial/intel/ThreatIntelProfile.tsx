/**
 * ThreatIntelProfile.tsx
 *
 * Holographic Intelligence Profile for an IOC in EXPLAIN-SEC SPATIAL.
 *
 * Visualizes:
 * 1. Indicator identity & deterministic local confidence
 * 2. Earliest (firstSeenAt) and latest (lastSeenAt) canonical timestamps
 * 3. Local observations breakdown across events, alerts, incidents, hunts, cases, evidence, assets, users
 * 4. Analytical threat context (malware families, campaigns, MITRE techniques)
 * 5. Synthesized graph relationships
 * 6. Honest offline provenance (LOCAL_SEED, LOCAL_ANALYST, etc.)
 * 7. One-click offline local enrichment trigger
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { securityService } from '../../core/security-service';
import type { ThreatIntelRecord, ThreatIntelRelationship } from '../../core/models/threat-intel';
import './threat-intel.css';

interface ThreatIntelProfileProps {
  indicatorId: string;
  onClose: () => void;
  onPivot?: (entityId: string, entityType: string) => void;
}

export const ThreatIntelProfile: React.FC<ThreatIntelProfileProps> = ({
  indicatorId,
  onClose,
  onPivot,
}) => {
  const [record, setRecord] = useState<ThreatIntelRecord | null>(null);
  const [relationships, setRelationships] = useState<ThreatIntelRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadIntel = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const rec = await securityService.getThreatIntel(indicatorId);
      const rels = await securityService.getThreatIntelRelationships(indicatorId);
      setRecord(rec);
      setRelationships(rels);
    } catch (err: any) {
      console.error('Failed to load threat intelligence profile:', err);
      setError(err?.message || 'Error loading threat intelligence.');
    } finally {
      setLoading(false);
    }
  }, [indicatorId]);

  useEffect(() => {
    loadIntel();
  }, [loadIntel]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleEnrich = async () => {
    try {
      setEnriching(true);
      const res = await securityService.enrichIndicatorLocally(indicatorId);
      setRecord(res.record);
      setRelationships(res.relationships);
    } catch (err: any) {
      console.error('Enrichment failed:', err);
      setError(err?.message || 'Enrichment failed.');
    } finally {
      setEnriching(false);
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return 'N/A';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const obsDetails = (record?.metadata?.observationDetails as Record<string, number>) || {};

  return (
    <div
      className="threat-intel-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="threat-intel-title"
    >
      <div className="threat-intel-profile-card">
        {/* Header */}
        <div className="threat-intel-header">
          <div className="threat-intel-title-area">
            <span className="threat-intel-kicker">
              <span>◈</span> Local Threat Intelligence Profile
            </span>
            <div className="threat-intel-value-row">
              <span id="threat-intel-title" className="threat-intel-value">
                {record?.indicatorValue || indicatorId}
              </span>
              {record?.indicatorType && (
                <span className="threat-intel-type-badge" style={{ color: '#00f0ff' }}>
                  {record.indicatorType}
                </span>
              )}
            </div>
          </div>

          <div className="threat-intel-header-badges">
            {record?.confidence && (
              <span className={`intel-badge-confidence ${record.confidence}`}>
                CONFIDENCE: {record.confidence}
              </span>
            )}
            <button
              className="threat-intel-close-btn"
              onClick={onClose}
              aria-label="Close intelligence profile"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="threat-intel-body">
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
              Scanning local telemetry and synthesizing relationships...
            </div>
          ) : error ? (
            <div style={{ padding: '1.5rem', color: '#ff3366', background: 'rgba(255,51,102,0.1)', borderRadius: 4 }}>
              {error}
            </div>
          ) : !record ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              No intelligence record found for this indicator.
            </div>
          ) : (
            <>
              {/* Summary Assessment */}
              <div className="threat-intel-summary-banner">
                <span className="threat-intel-assessment-title">
                  Local SOC Assessment • {record.classification || 'INVESTIGATIVE'}
                </span>
                <p className="threat-intel-desc">{record.description}</p>
              </div>

              {/* Observation Timeline & Provenance */}
              <div className="threat-intel-meta-grid">
                <div className="threat-intel-meta-cell">
                  <span className="intel-meta-label">First Seen (Local)</span>
                  <span className="intel-meta-value">{formatDate(record.firstSeenAt)}</span>
                </div>
                <div className="threat-intel-meta-cell">
                  <span className="intel-meta-label">Last Seen (Local)</span>
                  <span className="intel-meta-value">{formatDate(record.lastSeenAt)}</span>
                </div>
                <div className="threat-intel-meta-cell">
                  <span className="intel-meta-label">Source Origin</span>
                  <span className="intel-meta-value">{record.sourceType}</span>
                </div>
                <div className="threat-intel-meta-cell">
                  <span className="intel-meta-label">Evaluator</span>
                  <span className="intel-meta-value">{record.sourceName || 'SOC Deterministic Engine'}</span>
                </div>
              </div>

              {/* Local Telemetry Observations */}
              <div>
                <span className="threat-intel-section-title">
                  <span>◎</span> Telemetry Observations ({record.observationsCount || 0} occurrences)
                </span>
                <div className="threat-intel-obs-grid">
                  <div className="threat-intel-obs-pill">
                    <span className="intel-obs-count">{obsDetails.events ?? 0}</span>
                    <span className="intel-obs-name">Events</span>
                  </div>
                  <div className="threat-intel-obs-pill">
                    <span className="intel-obs-count">{obsDetails.alerts ?? 0}</span>
                    <span className="intel-obs-name">Alerts</span>
                  </div>
                  <div className="threat-intel-obs-pill">
                    <span className="intel-obs-count">{obsDetails.incidents ?? 0}</span>
                    <span className="intel-obs-name">Incidents</span>
                  </div>
                  <div className="threat-intel-obs-pill">
                    <span className="intel-obs-count">{obsDetails.hunts ?? 0}</span>
                    <span className="intel-obs-name">Hunts</span>
                  </div>
                  <div className="threat-intel-obs-pill">
                    <span className="intel-obs-count">{obsDetails.cases ?? 0}</span>
                    <span className="intel-obs-name">Cases</span>
                  </div>
                  <div className="threat-intel-obs-pill">
                    <span className="intel-obs-count">{obsDetails.assets ?? 0}</span>
                    <span className="intel-obs-name">Assets</span>
                  </div>
                  <div className="threat-intel-obs-pill">
                    <span className="intel-obs-count">{obsDetails.evidence ?? 0}</span>
                    <span className="intel-obs-name">Evidence</span>
                  </div>
                </div>
              </div>

              {/* Intelligence Context */}
              <div>
                <span className="threat-intel-section-title">
                  <span>✦</span> Contextual Associations
                </span>
                <div className="threat-intel-context-row">
                  {record.malwareFamilies?.map((mf) => (
                    <span key={mf} className="intel-chip malware">
                      <span>☣</span> Malware: {mf}
                    </span>
                  ))}
                  {record.campaigns?.map((c) => (
                    <span key={c} className="intel-chip campaign">
                      <span>⚡</span> Campaign: {c}
                    </span>
                  ))}
                  {record.mitreTechniqueIds?.map((t) => (
                    <span key={t} className="intel-chip mitre">
                      <span>⬡</span> MITRE: {t}
                    </span>
                  ))}
                  {record.tags?.map((t) => (
                    <span key={t} className="intel-chip">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Graph Relationships */}
              <div>
                <span className="threat-intel-section-title">
                  <span>☍</span> Canonical Relationships ({relationships.length})
                </span>
                {relationships.length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: '0.8rem', fontStyle: 'italic' }}>
                    No direct graph links synthesized yet. Run local enrichment to scan telemetry.
                  </div>
                ) : (
                  <div className="threat-intel-rel-list">
                    {relationships.slice(0, 10).map((rel) => (
                      <div key={rel.id} className="threat-intel-rel-row">
                        <div className="intel-rel-edge">
                          <span className="intel-rel-type">{rel.relationshipType}</span>
                          <span className="intel-rel-target-type">{rel.targetType}:</span>
                          <span className="intel-rel-target-id">{rel.targetId}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className="intel-rel-source">{rel.source}</span>
                          {onPivot && (
                            <button
                              className="threat-intel-btn secondary"
                              style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
                              onClick={() => onPivot(rel.targetId, rel.targetType)}
                            >
                              Pivot
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {relationships.length > 10 && (
                      <span style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center' }}>
                        + {relationships.length - 10} additional relationships in graph
                      </span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="threat-intel-footer">
          <div className="threat-intel-provenance-note">
            <span>🔒</span> 100% Offline Local Deterministic Assessment
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className="threat-intel-btn primary"
              onClick={handleEnrich}
              disabled={enriching || loading}
            >
              {enriching ? 'Enriching...' : '⚡ Re-run Local Enrichment'}
            </button>
            <button className="threat-intel-btn secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
