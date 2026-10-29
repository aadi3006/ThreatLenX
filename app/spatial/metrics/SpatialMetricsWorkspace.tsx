/**
 * SpatialMetricsWorkspace.tsx
 *
 * EXPLAIN-SEC SPATIAL SOC — STEP 10: METRICS + AI REFINEMENT
 *
 * Implements Progressive Metrics Disclosure:
 *   METRICS → OVERVIEW → SELECT METRIC → DETAIL
 *
 * Strict Invariants:
 * - Every metric derives purely from canonical security state (no Math.random(), no fake counters).
 * - "Do not render every chart simultaneously":
 *   - OVERVIEW: High-level cards grid of canonical metrics with summary values & status.
 *   - DETAIL: Renders focused visualization and provenance for ONLY the selected metric.
 * - Insufficient data handling: Displays explicit "INSUFFICIENT DATA" when sufficient data
 *   does not exist, rather than inventing or simulating values.
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { PerformanceMode } from '../performance-mode';
import { securityService } from '../../core/security-service';
import type {
  TimeWindow,
  SocOperationalSnapshot,
  TimeSeriesBucket,
  DistributionBucket,
  TopEntityItem,
  SocActivityTimelineItem,
  KpiResult,
  MetricProvenance,
  CanonicalMetricId,
} from '../../core/models/metrics';
import {
  Activity,
  ShieldAlert,
  AlertTriangle,
  Server,
  Zap,
  Clock,
  ChevronRight,
  ArrowLeft,
  X,
  Info,
  Calendar,
  Layers,
  CheckCircle2,
  FileText,
  Search,
  Sliders,
  ExternalLink,
} from 'lucide-react';
import { cyberAudio } from '../../cyber-audio';
import './soc-metrics.css';

interface SpatialMetricsWorkspaceProps {
  perfMode: PerformanceMode;
  onClose: () => void;
  onInvestigateIncident?: (incidentId: string) => void;
  onSelectAsset?: (assetId: string) => void;
}

const TIME_WINDOWS: { label: string; value: TimeWindow }[] = [
  { label: '15M', value: 'LAST_15_MINUTES' },
  { label: '1H', value: 'LAST_HOUR' },
  { label: '6H', value: 'LAST_6_HOURS' },
  { label: '24H', value: 'LAST_24_HOURS' },
  { label: '7D', value: 'LAST_7_DAYS' },
  { label: '30D', value: 'LAST_30_DAYS' },
  { label: 'ALL', value: 'ALL_TIME' },
];

interface MetricCardDef {
  id: CanonicalMetricId;
  label: string;
  category: string;
  kpi: KpiResult | undefined;
  icon: any;
}

export function SpatialMetricsWorkspace({
  perfMode,
  onClose,
  onInvestigateIncident,
  onSelectAsset,
}: SpatialMetricsWorkspaceProps) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('LAST_24_HOURS');
  const [snapshot, setSnapshot] = useState<SocOperationalSnapshot | null>(null);
  const [selectedMetricId, setSelectedMetricId] = useState<CanonicalMetricId | null>(null);

  // Detail State (only loaded for the selected metric)
  const [detailSeries, setDetailSeries] = useState<TimeSeriesBucket[]>([]);
  const [detailDistributions, setDetailDistributions] = useState<DistributionBucket[]>([]);
  const [detailEntities, setDetailEntities] = useState<TopEntityItem[]>([]);
  const [detailTimeline, setDetailTimeline] = useState<SocActivityTimelineItem[]>([]);
  const [provenance, setProvenance] = useState<MetricProvenance | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);

  // Load operational snapshot for OVERVIEW
  const loadSnapshot = useCallback(async () => {
    try {
      const snap = await securityService.getSocOperationalSnapshot({ window: timeWindow });
      setSnapshot(snap);
    } catch (err) {
      console.error('[SpatialMetrics] Failed to load snapshot:', err);
    }
  }, [timeWindow]);

  useEffect(() => {
    loadSnapshot();
    const unsub = securityService.subscribe('METRICS_UPDATED', () => loadSnapshot());
    return () => unsub();
  }, [loadSnapshot]);

  // All 13 canonical metrics required by Step 10
  const metricCards = useMemo<MetricCardDef[]>(() => {
    if (!snapshot) return [];
    return [
      { id: 'MTTD', label: 'Mean Time To Detect (MTTD)', category: 'DETECTION', kpi: snapshot.mttd, icon: Clock },
      { id: 'MTTA', label: 'Mean Time To Acknowledge (MTTA)', category: 'TRIAGE', kpi: snapshot.mtta, icon: Activity },
      { id: 'INCIDENT_MTTR', label: 'Incident Resolution (MTTR)', category: 'INCIDENTS', kpi: snapshot.incidentMttr, icon: CheckCircle2 },
      { id: 'ALERT_MTTR', label: 'Alert Resolution (MTTR)', category: 'ALERTS', kpi: snapshot.alertMttr, icon: CheckCircle2 },
      { id: 'ALERT_VOLUME', label: 'Alert Volume', category: 'ALERTS', kpi: snapshot.alertVolume, icon: ShieldAlert },
      { id: 'DETECTION_VOLUME', label: 'Detection Volume', category: 'TELEMETRY', kpi: snapshot.detectionVolume, icon: Layers },
      { id: 'INCIDENT_VOLUME', label: 'Incident Volume', category: 'INCIDENTS', kpi: snapshot.incidentVolume, icon: AlertTriangle },
      { id: 'SEVERITY_DISTRIBUTION', label: 'Severity Distribution', category: 'THREAT_POSTURE', kpi: snapshot.severityDistributionMetric, icon: Sliders },
      { id: 'RESPONSE_ACTIONS', label: 'Response Actions', category: 'SOAR', kpi: snapshot.responseActionsMetric, icon: Zap },
      { id: 'DETECTION_EFFICACY', label: 'Detection Efficacy', category: 'DETECTION', kpi: snapshot.detectionEfficacy, icon: ShieldAlert },
      { id: 'INVESTIGATION_DURATION', label: 'Investigation Duration', category: 'INVESTIGATION', kpi: snapshot.investigationDuration, icon: FileText },
      { id: 'ANALYST_ACTIVITY', label: 'Analyst Activity', category: 'OPERATIONS', kpi: snapshot.analystActivity, icon: Activity },
      { id: 'ASSET_EXPOSURE', label: 'Asset Exposure', category: 'INFRASTRUCTURE', kpi: snapshot.assetExposure, icon: Server },
      { id: 'RECURRING_ATTACK_PATTERNS', label: 'Recurring Attack Patterns', category: 'THREAT_INTEL', kpi: snapshot.recurringAttackPatterns, icon: Search },
    ];
  }, [snapshot]);

  // Selected KPI
  const activeMetricCard = useMemo(() => {
    if (!selectedMetricId) return null;
    return metricCards.find((m) => m.id === selectedMetricId) || null;
  }, [selectedMetricId, metricCards]);

  // Load focused detail data ONLY when a metric is selected
  useEffect(() => {
    if (!selectedMetricId) {
      setDetailSeries([]);
      setDetailDistributions([]);
      setDetailEntities([]);
      setDetailTimeline([]);
      setProvenance(null);
      return;
    }

    let isMounted = true;
    const fetchDetail = async () => {
      setIsLoadingDetail(true);
      const filter = { window: timeWindow };

      try {
        const provPromise = securityService.getMetricProvenance(selectedMetricId, filter);

        if (selectedMetricId === 'ALERT_VOLUME') {
          const [series, prov] = await Promise.all([
            securityService.getTimeSeries('ALERTS', filter, perfMode === 'LOW' ? 15 : 30),
            provPromise,
          ]);
          if (isMounted) {
            setDetailSeries(series);
            setProvenance(prov);
          }
        } else if (selectedMetricId === 'DETECTION_VOLUME') {
          const [series, prov] = await Promise.all([
            securityService.getTimeSeries('EVENTS', filter, perfMode === 'LOW' ? 15 : 30),
            provPromise,
          ]);
          if (isMounted) {
            setDetailSeries(series);
            setProvenance(prov);
          }
        } else if (selectedMetricId === 'INCIDENT_VOLUME') {
          const [series, prov] = await Promise.all([
            securityService.getTimeSeries('INCIDENTS', filter, perfMode === 'LOW' ? 15 : 30),
            provPromise,
          ]);
          if (isMounted) {
            setDetailSeries(series);
            setProvenance(prov);
          }
        } else if (selectedMetricId === 'RESPONSE_ACTIONS') {
          const [series, prov] = await Promise.all([
            securityService.getTimeSeries('RESPONSE', filter, perfMode === 'LOW' ? 15 : 30),
            provPromise,
          ]);
          if (isMounted) {
            setDetailSeries(series);
            setProvenance(prov);
          }
        } else if (selectedMetricId === 'SEVERITY_DISTRIBUTION') {
          const [evSev, alSev, prov] = await Promise.all([
            securityService.getDistributions('EVENTS_BY_SEVERITY', filter),
            securityService.getDistributions('ALERTS_BY_SEVERITY', filter),
            provPromise,
          ]);
          if (isMounted) {
            setDetailDistributions(alSev.length > 0 ? alSev : evSev);
            setProvenance(prov);
          }
        } else if (selectedMetricId === 'ASSET_EXPOSURE') {
          const [assets, prov] = await Promise.all([
            securityService.getTopEntities('TOP_AFFECTED_ASSETS', filter, 10),
            provPromise,
          ]);
          if (isMounted) {
            setDetailEntities(assets);
            setProvenance(prov);
          }
        } else if (selectedMetricId === 'ANALYST_ACTIVITY') {
          const [tl, prov] = await Promise.all([
            securityService.getSocActivityTimeline(filter, 30),
            provPromise,
          ]);
          if (isMounted) {
            setDetailTimeline(tl);
            setProvenance(prov);
          }
        } else {
          // MTTD, MTTA, MTTR, DETECTION_EFFICACY, INVESTIGATION_DURATION, RECURRING_ATTACK_PATTERNS
          const prov = await provPromise;
          if (isMounted) setProvenance(prov);
        }
      } catch (err) {
        console.error('[SpatialMetrics] Failed to load detail for metric:', selectedMetricId, err);
      } finally {
        if (isMounted) setIsLoadingDetail(false);
      }
    };

    fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [selectedMetricId, timeWindow, perfMode]);

  // SVG Chart points calculation for the single active time series
  const maxBucketCount = useMemo(() => {
    if (detailSeries.length === 0) return 1;
    return Math.max(...detailSeries.map((b) => b.count), 1);
  }, [detailSeries]);

  const svgPoints = useMemo(() => {
    if (detailSeries.length === 0) return '';
    const width = 640;
    const height = 160;
    const padding = 20;
    const effWidth = width - padding * 2;
    const effHeight = height - padding * 2;
    const stepX = effWidth / Math.max(detailSeries.length - 1, 1);

    return detailSeries
      .map((b, i) => {
        const x = padding + i * stepX;
        const normY = b.count / maxBucketCount;
        const y = height - padding - normY * effHeight;
        return `${Math.round(x)},${Math.round(y)}`;
      })
      .join(' ');
  }, [detailSeries, maxBucketCount]);

  const threatColor = useMemo(() => {
    if (!snapshot) return '#3dffb0';
    switch (snapshot.threatLevel) {
      case 'CRITICAL':
        return '#ff3366';
      case 'HIGH':
        return '#ffaa00';
      case 'ELEVATED':
        return '#00f0ff';
      default:
        return '#3dffb0';
    }
  }, [snapshot]);

  return (
    <div
      className={`soc-metrics-workspace tier-${perfMode.toLowerCase()}`}
      aria-label="SOC Metrics and Operational Analytics Workspace"
    >
      {/* ─── TOP CONTROL STRIP ────────────────────────────────────────────────── */}
      <header className="metrics-top-strip">
        <div className="metrics-title-block">
          <Activity size={18} color="#00f0ff" />
          <span className="metrics-title">SOC METRICS // OPERATIONAL ANALYTICS</span>
          {snapshot && (
            <span
              style={{
                fontSize: 10,
                color: threatColor,
                border: `1px solid ${threatColor}`,
                padding: '2px 8px',
                borderRadius: 4,
                fontWeight: 800,
                background: 'rgba(0,0,0,0.4)',
              }}
            >
              THREAT LEVEL: {snapshot.threatLevel} [{snapshot.threatScore}/100]
            </span>
          )}
        </div>

        {/* Time Window Selector */}
        <div className="metrics-time-pills">
          <Calendar size={12} color="#8899aa" style={{ marginRight: 4 }} />
          {TIME_WINDOWS.map((tw) => (
            <button
              key={tw.value}
              className={`time-pill-btn ${timeWindow === tw.value ? 'active' : ''}`}
              onClick={() => {
                cyberAudio.playClick();
                setTimeWindow(tw.value);
              }}
            >
              {tw.label}
            </button>
          ))}
        </div>

        <div className="metrics-top-actions">
          <button
            className="metrics-close-btn"
            onClick={() => {
              cyberAudio.playClick();
              onClose();
            }}
          >
            <X size={14} />
            <span>CLOSE [ESC]</span>
          </button>
        </div>
      </header>

      {/* ─── BREADCRUMB NAVIGATION (Progressive Disclosure) ───────────────────── */}
      <nav className="metrics-breadcrumb-strip" aria-label="Metrics Navigation Hierarchy">
        <div className="metrics-breadcrumb">
          <span
            className={`metrics-breadcrumb-crumb ${!selectedMetricId ? 'active' : ''}`}
            onClick={() => {
              if (selectedMetricId) {
                cyberAudio.playClick();
                setSelectedMetricId(null);
              }
            }}
          >
            METRICS
          </span>
          <ChevronRight size={12} color="#8899aa" />
          <span
            className={`metrics-breadcrumb-crumb ${selectedMetricId ? '' : 'active'}`}
            onClick={() => {
              if (selectedMetricId) {
                cyberAudio.playClick();
                setSelectedMetricId(null);
              }
            }}
          >
            OVERVIEW
          </span>
          {activeMetricCard && (
            <>
              <ChevronRight size={12} color="#8899aa" />
              <span className="metrics-breadcrumb-crumb active">
                {activeMetricCard.label}
              </span>
            </>
          )}
        </div>

        {selectedMetricId && (
          <button
            className="metrics-back-btn"
            onClick={() => {
              cyberAudio.playClick();
              setSelectedMetricId(null);
            }}
          >
            <ArrowLeft size={12} />
            <span>BACK TO OVERVIEW</span>
          </button>
        )}
      </nav>

      {/* ─── STAGE 1: METRICS OVERVIEW (Cards Grid - Zero Simultaneous Charts) ─── */}
      {!selectedMetricId && (
        <main className="metrics-overview-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
            <span style={{ fontSize: 10, color: '#8899aa', letterSpacing: '0.08em' }}>
              CANONICAL SOC OPERATIONAL METRICS // SELECT A METRIC TO INSPECT FOCUSED TELEMETRY & PROVENANCE
            </span>
            <span style={{ fontSize: 9.5, color: '#00f0ff', letterSpacing: '0.05em' }}>
              {metricCards.length} CANONICAL METRICS DERIVED
            </span>
          </div>

          <div className="metrics-overview-grid">
            {metricCards.map((m) => {
              const IconComp = m.icon;
              const isInsufficient = m.kpi?.status === 'INSUFFICIENT_DATA';
              return (
                <div
                  key={m.id}
                  className={`metric-overview-card soc-motion-interactive ${isInsufficient ? 'insufficient' : ''}`}
                  onClick={() => {
                    cyberAudio.playSelect();
                    setSelectedMetricId(m.id);
                  }}
                  title={`Select ${m.label} to inspect focused visualization`}
                  role="button"
                  tabIndex={0}
                >
                  <div>
                    <div className="card-header-row">
                      <span className="card-category-tag">{m.category}</span>
                      <IconComp size={14} color={isInsufficient ? '#ffaa00' : '#00f0ff'} />
                    </div>

                    <div className="card-metric-title">{m.label}</div>

                    <div className="card-value-row">
                      <span className={`card-metric-val ${isInsufficient ? 'insufficient' : ''}`}>
                        {m.kpi ? m.kpi.formattedValue : 'INSUFFICIENT DATA'}
                      </span>
                    </div>
                  </div>

                  <div className="card-footer-row">
                    <span>
                      {m.kpi && m.kpi.explanation.sampleSize > 0
                        ? `${m.kpi.explanation.sampleSize} qualifying records`
                        : isInsufficient
                        ? 'Insufficient sample size'
                        : '0 records scanned'}
                    </span>
                    <span className="card-cta-badge soc-motion-meta-reveal">
                      INSPECT DETAIL
                      <ChevronRight size={11} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Canonical State Integrity Strip */}
          <footer
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 14px',
              background: 'rgba(8, 14, 26, 0.65)',
              borderRadius: 6,
              border: '1px solid rgba(255, 255, 255, 0.06)',
              fontSize: 9.5,
              color: '#8899aa',
            }}
          >
            <span>
              ◈ CANONICAL INTEGRITY: 100% Offline | Zero Math.random() | Zero Simulated Counters
            </span>
            <span>
              Store Snapshot Generated: {snapshot ? new Date(snapshot.generatedAt).toLocaleTimeString() : '...'}
            </span>
          </footer>
        </main>
      )}

      {/* ─── STAGE 2: METRIC DETAIL (Focused Single Visualization + Provenance) ── */}
      {selectedMetricId && activeMetricCard && (
        <main className="metric-detail-layout">
          {/* Left/Main Column: Focused Visualization */}
          <section className="detail-visual-panel">
            {/* Metric KPI Banner */}
            <div
              style={{
                background: 'rgba(8, 14, 26, 0.88)',
                border: '1px solid rgba(0, 240, 255, 0.22)',
                borderRadius: 8,
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <span className="card-category-tag" style={{ marginBottom: 4, display: 'inline-block' }}>
                  {activeMetricCard.category} // CANONICAL KPI
                </span>
                <h1 style={{ fontSize: 16, fontWeight: 800, color: '#e0f2fe', margin: '4px 0' }}>
                  {activeMetricCard.label}
                </h1>
                <div style={{ fontSize: 10, color: '#8899aa' }}>
                  Scope: {timeWindow} • Unit: {activeMetricCard.kpi?.unit || 'count'}
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div
                  className={`card-metric-val ${
                    activeMetricCard.kpi?.status === 'INSUFFICIENT_DATA' ? 'insufficient' : ''
                  }`}
                  style={{ fontSize: 24 }}
                >
                  {activeMetricCard.kpi ? activeMetricCard.kpi.formattedValue : 'INSUFFICIENT DATA'}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color:
                      activeMetricCard.kpi?.status === 'CRITICAL'
                        ? '#ff3366'
                        : activeMetricCard.kpi?.status === 'WARNING'
                        ? '#ffaa00'
                        : activeMetricCard.kpi?.status === 'INSUFFICIENT_DATA'
                        ? '#ffaa00'
                        : '#3dffb0',
                    marginTop: 3,
                  }}
                >
                  STATUS: {activeMetricCard.kpi?.status || 'INSUFFICIENT_DATA'}
                </div>
              </div>
            </div>

            {/* Single Focused Visual Card */}
            <div className="detail-chart-card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  paddingBottom: 8,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: '#00f0ff', letterSpacing: '0.08em' }}>
                  FOCUSED TELEMETRY PRESENTATION
                </span>
                <span style={{ fontSize: 9.5, color: '#8899aa' }}>
                  {isLoadingDetail ? 'Querying local store...' : 'Single focused stream'}
                </span>
              </div>

              {/* Insufficient Data State */}
              {activeMetricCard.kpi?.status === 'INSUFFICIENT_DATA' ? (
                <div className="insufficient-data-card">
                  <AlertTriangle size={32} color="#ffaa00" />
                  <div className="insufficient-data-title">INSUFFICIENT DATA</div>
                  <div className="insufficient-data-reason">
                    {activeMetricCard.kpi?.explanation.missingDataReason ||
                      'Insufficient sample points exist in the canonical local store to compute this metric accurately.'}
                  </div>
                  <div className="insufficient-data-criteria">
                    Criteria: Requires at least 1 verified qualifying record in time window [{timeWindow}]
                  </div>
                </div>
              ) : selectedMetricId === 'ALERT_VOLUME' ||
                selectedMetricId === 'DETECTION_VOLUME' ||
                selectedMetricId === 'INCIDENT_VOLUME' ||
                selectedMetricId === 'RESPONSE_ACTIONS' ? (
                /* Time Series Curve for Volume Metrics */
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 10, color: '#8899aa', marginBottom: 8 }}>
                    TIME-SERIES INFLOW (Max Peak: {maxBucketCount})
                  </div>
                  {perfMode !== 'LOW' && (
                    <svg viewBox="0 0 640 160" style={{ width: '100%', height: 160, overflow: 'visible' }}>
                      <defs>
                        <linearGradient id="detailGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.45" />
                          <stop offset="100%" stopColor="#00f0ff" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      <line x1="20" y1="20" x2="620" y2="20" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                      <line x1="20" y1="80" x2="620" y2="80" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                      <line x1="20" y1="140" x2="620" y2="140" stroke="rgba(255,255,255,0.14)" />

                      {svgPoints && (
                        <>
                          <polyline
                            fill="none"
                            stroke="#00f0ff"
                            strokeWidth="2.5"
                            points={svgPoints}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <polygon
                            fill="url(#detailGrad)"
                            points={`20,140 ${svgPoints} 620,140`}
                            opacity="0.7"
                          />
                        </>
                      )}
                    </svg>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 9,
                      color: '#8899aa',
                      marginTop: 8,
                    }}
                  >
                    <span>{detailSeries[0]?.label || 'Start'}</span>
                    <span>{detailSeries[Math.floor(detailSeries.length / 2)]?.label || 'Midpoint'}</span>
                    <span>{detailSeries[detailSeries.length - 1]?.label || 'Now'}</span>
                  </div>
                </div>
              ) : selectedMetricId === 'SEVERITY_DISTRIBUTION' ? (
                /* Severity Distribution Bars */
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 10, color: '#8899aa', marginBottom: 12 }}>
                    CANONICAL SEVERITY RATIOS ACROSS THREAT ENTITIES
                  </div>
                  {detailDistributions.map((d) => (
                    <div key={d.label} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700 }}>{d.label}</span>
                        <span style={{ color: '#00f0ff' }}>
                          {d.count} ({d.percentage}%)
                        </span>
                      </div>
                      <div style={{ width: '100%', height: 8, background: 'rgba(0,0,0,0.4)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${d.percentage}%`, height: '100%', background: d.color || '#00f0ff' }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : selectedMetricId === 'ASSET_EXPOSURE' ? (
                /* Asset Exposure Breakdown */
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <div style={{ fontSize: 10, color: '#8899aa', marginBottom: 10 }}>
                    MONITORED HOSTS EXPOSURE STATUS
                  </div>
                  {detailEntities.length === 0 ? (
                    <div style={{ fontSize: 10, color: '#8899aa' }}>No affected hosts in time window</div>
                  ) : (
                    detailEntities.map((a) => (
                      <div
                        key={a.id}
                        className="top-entity-row"
                        onClick={() => onSelectAsset?.(a.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div>
                          <div className="entity-info-name">{a.name}</div>
                          <div className="entity-info-sub">{a.details || a.id}</div>
                        </div>
                        <span className="entity-count-badge">{a.count} events</span>
                      </div>
                    ))
                  )}
                </div>
              ) : selectedMetricId === 'ANALYST_ACTIVITY' ? (
                /* Analyst Audit Stream */
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <div style={{ fontSize: 10, color: '#8899aa', marginBottom: 10 }}>
                    RECENT IMMUTABLE AUDIT OPERATIONS
                  </div>
                  {detailTimeline.slice(0, 8).map((item) => (
                    <div key={item.id} className="timeline-card sev-medium" style={{ marginBottom: 6 }}>
                      <span className="timeline-card-time">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div className="timeline-card-body">
                        <div className="timeline-card-title">{item.title}</div>
                        {item.details && <div className="timeline-card-details">{item.details}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* Gauges / Value Card for MTTD, MTTA, MTTR, Duration, Efficacy, Recurring Patterns */
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#00f0ff', marginBottom: 8 }}>
                    {activeMetricCard.kpi?.formattedValue}
                  </div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', maxWidth: 420, lineHeight: 1.5 }}>
                    {activeMetricCard.kpi?.explanation.what}
                  </div>
                  <div
                    style={{
                      marginTop: 16,
                      fontSize: 10,
                      color: '#3dffb0',
                      background: 'rgba(61, 255, 176, 0.08)',
                      padding: '6px 14px',
                      borderRadius: 4,
                      border: '1px solid rgba(61, 255, 176, 0.25)',
                    }}
                  >
                    Sample Size: {activeMetricCard.kpi?.explanation.sampleSize} verified canonical records
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Right Column: Explainable Mathematical Provenance */}
          <aside className="detail-provenance-panel">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                fontWeight: 800,
                color: '#00f0ff',
                marginBottom: 14,
                borderBottom: '1px solid rgba(0, 240, 255, 0.2)',
                paddingBottom: 8,
              }}
            >
              <Info size={15} />
              <span>EXPLAINABLE MATHEMATICAL PROVENANCE</span>
            </div>

            <div className="prov-field">
              <div className="prov-key">WHAT THIS MEASURES</div>
              <div className="prov-val">{activeMetricCard.kpi?.explanation.what}</div>
            </div>

            <div className="prov-field">
              <div className="prov-key">WHY IT MATTERS</div>
              <div className="prov-val">{activeMetricCard.kpi?.explanation.why}</div>
            </div>

            <div className="prov-field">
              <div className="prov-key">MATHEMATICAL FORMULA</div>
              <div className="prov-val prov-formula">
                {activeMetricCard.kpi?.explanation.formula || 'Canonical mathematical summation'}
              </div>
            </div>

            <div className="prov-field">
              <div className="prov-key">AUTHORITATIVE SOURCE STORE</div>
              <div className="prov-val">
                {activeMetricCard.kpi?.explanation.source || provenance?.sourceStore || 'IndexedDB Canonical Store'}
              </div>
            </div>

            <div className="prov-field">
              <div className="prov-key">QUALIFYING SAMPLE SIZE</div>
              <div className="prov-val">
                {activeMetricCard.kpi?.explanation.sampleSize ?? 0} records qualified in window [{timeWindow}]
              </div>
            </div>

            {activeMetricCard.kpi?.explanation.missingDataReason && (
              <div className="prov-field">
                <div className="prov-key" style={{ color: '#ffaa00' }}>
                  INSUFFICIENT DATA EXPLANATION
                </div>
                <div className="prov-val" style={{ color: '#ffaa00', borderColor: 'rgba(255, 170, 0, 0.3)' }}>
                  {activeMetricCard.kpi.explanation.missingDataReason}
                </div>
              </div>
            )}

            {provenance && (
              <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
                <div className="prov-key">DATABASE QUERY AUDIT TRAIL</div>
                <div style={{ fontSize: 9.5, color: '#8899aa', lineHeight: 1.6 }}>
                  <div>• Table: {provenance.sourceStore}</div>
                  <div>• Scope Filter: {provenance.filterApplied}</div>
                  <div>• Scanned Records: {provenance.totalRecordsScanned}</div>
                  <div>• Qualifying Records: {provenance.qualifyingRecords}</div>
                  <div>• Computed At: {new Date(provenance.computedAt).toISOString()}</div>
                </div>

                {provenance.sampleIds && provenance.sampleIds.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div className="prov-key">SAMPLE AUTHORITATIVE IDs</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {provenance.sampleIds.map((id) => (
                        <span
                          key={id}
                          style={{
                            fontSize: 9,
                            color: '#00f0ff',
                            background: 'rgba(0, 240, 255, 0.08)',
                            padding: '2px 6px',
                            borderRadius: 3,
                            border: '1px solid rgba(0, 240, 255, 0.2)',
                          }}
                        >
                          {id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>
        </main>
      )}
    </div>
  );
}

export default SpatialMetricsWorkspace;
