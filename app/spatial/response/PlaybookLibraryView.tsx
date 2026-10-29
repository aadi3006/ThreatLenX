/**
 * PlaybookLibraryView.tsx
 *
 * Spatial Playbook Library allowing SOC analysts to browse, filter, inspect,
 * validate, dry-run, enable/disable, and trigger offline SOAR workflows.
 */

'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  BookOpen,
  Search,
  CheckCircle,
  AlertTriangle,
  Play,
  Eye,
  Sliders,
  Shield,
  Layers,
  Clock,
  Lock,
  Tag,
  RefreshCw,
} from 'lucide-react';
import type { Playbook, PlaybookCategory, DryRunResult } from '../../core/models/response';
import type { UserSession } from '../../core/models/auth';
import { securityService } from '../../core/security-service';
import { cyberAudio } from '../../cyber-audio';

interface PlaybookLibraryViewProps {
  session: UserSession | null;
  incidentId?: string;
  onExecutePlaybook?: (playbookId: string) => void;
}

export default function PlaybookLibraryView({
  session,
  incidentId,
  onExecutePlaybook,
}: PlaybookLibraryViewProps) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadPlaybooks = async () => {
    try {
      const pbs = await securityService.getPlaybooks();
      setPlaybooks(pbs);
      if (!selectedPlaybook && pbs.length > 0) {
        setSelectedPlaybook(pbs[0]);
      }
    } catch (err: any) {
      console.error('Failed to load playbooks:', err);
    }
  };

  useEffect(() => {
    loadPlaybooks();
    const unsub = securityService.subscribe('PLAYBOOKS_UPDATED', () => loadPlaybooks());
    return () => unsub();
  }, []);

  const filteredPlaybooks = useMemo(() => {
    return playbooks.filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.playbookId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory =
        selectedCategory === 'ALL' || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [playbooks, searchQuery, selectedCategory]);

  const handleDryRun = async (playbook: Playbook) => {
    cyberAudio.playSelect();
    setIsSimulating(true);
    setDryRunResult(null);
    try {
      const result = await securityService.dryRunPlaybook(playbook.id, session?.username ?? 'analyst');
      setDryRunResult(result);
      cyberAudio.playSuccess?.();
    } catch (err: any) {
      setStatusMsg(`Dry run failed: ${err.message}`);
      cyberAudio.playAlert?.();
    } finally {
      setIsSimulating(false);
    }
  };

  const handleValidate = async (playbook: Playbook) => {
    cyberAudio.playClick();
    try {
      const res = await securityService.validatePlaybook(playbook);
      setValidationResult(res);
    } catch (err: any) {
      setStatusMsg(`Validation error: ${err.message}`);
    }
  };

  const handleToggleEnable = async (playbook: Playbook) => {
    cyberAudio.playClick();
    try {
      if (playbook.enabled) {
        await securityService.disablePlaybook(playbook.id);
        setStatusMsg(`Playbook ${playbook.playbookId} disabled.`);
      } else {
        await securityService.enablePlaybook(playbook.id);
        setStatusMsg(`Playbook ${playbook.playbookId} enabled.`);
      }
      await loadPlaybooks();
    } catch (err: any) {
      setStatusMsg(`Toggle failed: ${err.message}`);
    }
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', gap: 16, padding: '12px 16px', overflow: 'hidden' }}>
      {/* ── Left Column: Playbook List & Search ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 320, borderRight: '1px solid rgba(0, 240, 255, 0.15)', paddingRight: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#00f0ff', fontSize: 13, fontWeight: 700 }}>
            <BookOpen size={14} /> SOAR PLAYBOOK LIBRARY ({filteredPlaybooks.length})
          </div>
          <button className="resp-btn" onClick={loadPlaybooks} title="Refresh Library" style={{ padding: '3px 6px' }}>
            <RefreshCw size={11} />
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 240, 255, 0.05)', border: '1px solid rgba(0, 240, 255, 0.2)', borderRadius: 4, padding: '4px 8px' }}>
          <Search size={12} color="#64748b" style={{ marginRight: 6 }} />
          <input
            type="text"
            placeholder="Search playbooks, tags, categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e2e8f0',
              fontSize: 11,
              width: '100%',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Category Filters */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['ALL', 'CONTAINMENT', 'ERADICATION', 'REMEDIATION', 'INVESTIGATION', 'ESCALATION'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 3,
                border: '1px solid',
                borderColor: selectedCategory === cat ? '#00f0ff' : 'rgba(255,255,255,0.1)',
                background: selectedCategory === cat ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
                color: selectedCategory === cat ? '#00f0ff' : '#94a3b8',
                cursor: 'pointer',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Playbook Cards List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
          {filteredPlaybooks.map((pb) => {
            const isSelected = selectedPlaybook?.id === pb.id;
            return (
              <div
                key={pb.id}
                onClick={() => {
                  cyberAudio.playClick();
                  setSelectedPlaybook(pb);
                  setDryRunResult(null);
                  setValidationResult(null);
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: `1px solid ${isSelected ? '#00f0ff' : 'rgba(255,255,255,0.08)'}`,
                  background: isSelected ? 'rgba(0, 240, 255, 0.08)' : 'rgba(15, 23, 42, 0.6)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: '#00f0ff', fontWeight: 700 }}>
                    {pb.playbookId} · v{pb.version}
                  </span>
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 800,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: pb.enabled ? 'rgba(61,255,176,0.15)' : 'rgba(255,42,42,0.15)',
                      color: pb.enabled ? '#3dffb0' : '#ff6b6b',
                      border: `1px solid ${pb.enabled ? '#3dffb040' : '#ff424240'}`,
                    }}
                  >
                    {pb.status}
                  </span>
                </div>

                <div style={{ fontSize: 11, fontWeight: 700, color: '#f8fafc', marginBottom: 4 }}>
                  {pb.name}
                </div>

                <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.3, marginBottom: 6, maxHeight: 28, overflow: 'hidden' }}>
                  {pb.description}
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 9, color: '#64748b' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Layers size={9} /> {pb.steps.length} Steps
                  </span>
                  <span>·</span>
                  <span style={{ color: '#ffb700' }}>{pb.category}</span>
                  <span>·</span>
                  <span>{pb.triggerTypes?.join(', ') || pb.triggerType}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right Column: Playbook Inspector & Controls ── */}
      <div style={{ flex: 1.3, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', paddingLeft: 4 }}>
        {selectedPlaybook ? (
          <>
            {/* Inspector Header */}
            <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(0, 240, 255, 0.2)', borderRadius: 6, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#00f0ff' }}>
                      {selectedPlaybook.name}
                    </span>
                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'rgba(0,240,255,0.1)', color: '#00f0ff', border: '1px solid rgba(0,240,255,0.3)' }}>
                      v{selectedPlaybook.version}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                    ID: {selectedPlaybook.playbookId} · Author: {selectedPlaybook.author} · Published: {selectedPlaybook.publishedAt ?? 'DRAFT'}
                  </div>
                </div>

                {/* Control Action Buttons */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="resp-btn"
                    onClick={() => handleValidate(selectedPlaybook)}
                    title="Validate Structure"
                    style={{ fontSize: 10, padding: '4px 8px' }}
                  >
                    <CheckCircle size={10} /> VALIDATE
                  </button>

                  <button
                    className="resp-btn resp-btn-secondary"
                    onClick={() => handleDryRun(selectedPlaybook)}
                    disabled={isSimulating}
                    style={{ fontSize: 10, padding: '4px 8px', borderColor: '#ffb700', color: '#ffb700' }}
                  >
                    <Eye size={10} /> {isSimulating ? 'SIMULATING...' : 'DRY RUN'}
                  </button>

                  {selectedPlaybook.enabled && onExecutePlaybook && (
                    <button
                      className="resp-btn resp-btn-primary"
                      onClick={() => onExecutePlaybook(selectedPlaybook.id)}
                      style={{ fontSize: 10, padding: '4px 10px' }}
                    >
                      <Play size={10} /> EXECUTE
                    </button>
                  )}

                  <button
                    className="resp-btn"
                    onClick={() => handleToggleEnable(selectedPlaybook)}
                    style={{ fontSize: 10, padding: '4px 8px', color: selectedPlaybook.enabled ? '#ff6b6b' : '#3dffb0' }}
                  >
                    {selectedPlaybook.enabled ? 'DISABLE' : 'ENABLE'}
                  </button>
                </div>
              </div>

              <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.4, marginBottom: 8 }}>
                {selectedPlaybook.description}
              </div>

              {/* Tags Strip */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(selectedPlaybook.tags || []).map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: 8,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: 'rgba(255,255,255,0.06)',
                      color: '#94a3b8',
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Validation Feedback */}
            {validationResult && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 4,
                  background: validationResult.valid ? 'rgba(61,255,176,0.1)' : 'rgba(255,42,42,0.1)',
                  border: `1px solid ${validationResult.valid ? '#3dffb060' : '#ff424260'}`,
                  fontSize: 10,
                  color: validationResult.valid ? '#3dffb0' : '#ff6b6b',
                }}
              >
                {validationResult.valid ? (
                  <span>✓ Deterministic playbook validation passed. Structure is production-ready.</span>
                ) : (
                  <div>
                    <span style={{ fontWeight: 700 }}>Validation errors:</span>
                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                      {validationResult.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Dry Run Simulation Output */}
            {dryRunResult && (
              <div
                style={{
                  background: 'rgba(255, 183, 0, 0.08)',
                  border: '1px solid rgba(255, 183, 0, 0.4)',
                  borderRadius: 6,
                  padding: '10px 12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#ffb700', letterSpacing: '0.05em' }}>
                    ⚡ OFFLINE DRY RUN SIMULATION PREVIEW (ZERO MUTATION)
                  </span>
                  <span style={{ fontSize: 9, color: '#94a3b8' }}>
                    Simulated at: {new Date(dryRunResult.simulatedAt).toLocaleTimeString()}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {dryRunResult.simulatedSteps.map((step) => (
                    <div
                      key={step.stepId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 10,
                        padding: '4px 8px',
                        background: 'rgba(0,0,0,0.3)',
                        borderRadius: 4,
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 700, color: '#e2e8f0', marginRight: 6 }}>
                          {step.name}:
                        </span>
                        <span style={{ color: '#ffb700' }}>{step.expectedStateChange}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {step.requiresApproval && (
                          <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 2, background: 'rgba(255,42,42,0.2)', color: '#ff6b6b' }}>
                            APPROVAL REQ
                          </span>
                        )}
                        <span style={{ fontSize: 8, color: '#64748b' }}>{step.reversibility}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Steps Visual Sequence */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
                WORKFLOW STEP SEQUENCE ({selectedPlaybook.steps.length})
              </div>

              {selectedPlaybook.steps.map((step, idx) => (
                <div
                  key={step.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 4,
                    background: 'rgba(15, 23, 42, 0.4)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: 'rgba(0, 240, 255, 0.15)',
                      color: '#00f0ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {step.order ?? idx + 1}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#f8fafc' }}>
                        {step.name}
                      </span>
                      <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: 'rgba(0,240,255,0.1)', color: '#00f0ff' }}>
                        {step.type}
                      </span>
                      {step.requiresApproval && (
                        <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: 'rgba(255,183,0,0.15)', color: '#ffb700', display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Lock size={8} /> APPROVAL
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                      {step.description}
                    </div>
                  </div>

                  {step.actionType && (
                    <div style={{ fontSize: 9, color: '#a78bfa', fontWeight: 600 }}>
                      {step.actionType}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ color: '#64748b', fontSize: 11, padding: 20, textAlign: 'center' }}>
            Select a playbook from the catalog to inspect workflow parameters.
          </div>
        )}
      </div>
    </div>
  );
}
