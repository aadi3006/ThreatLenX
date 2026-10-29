import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  Search,
  Plus,
  Play,
  CheckCircle,
  AlertTriangle,
  FileCode,
  Layers,
  Clock,
  Tag,
  GitBranch,
  X,
  RefreshCw,
  Copy,
  Trash2,
  Sliders,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { securityService } from '../../core/security-service';
import type {
  DetectionRule,
  DetectionRuleVersion,
  RuleValidationResult,
  DetectionTestRunResult,
  RuleDiffResult,
  RuleCondition,
  EventCategory,
  Severity,
  RuleLifecycleStatus,
} from '../../core/models';
import './detection-engineering.css';

interface DetectionEngineeringWorkspaceProps {
  perfMode?: string;
  onClose: () => void;
  initialRuleId?: string;
}

export const DetectionEngineeringWorkspace: React.FC<DetectionEngineeringWorkspaceProps> = ({
  perfMode = 'FULL',
  onClose,
  initialRuleId,
}) => {
  const [rules, setRules] = useState<DetectionRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(initialRuleId || null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'INSPECTOR' | 'VERSIONS' | 'DIFF'>('INSPECTOR');

  // Rule Editing State
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editSeverity, setEditSeverity] = useState<Severity>('HIGH');
  const [editCategory, setEditCategory] = useState<EventCategory>('PROCESS');
  const [editMitre, setEditMitre] = useState('');
  const [editConditions, setEditConditions] = useState<RuleCondition[]>([]);

  // Simulation & Validation State
  const [validationResult, setValidationResult] = useState<RuleValidationResult | null>(null);
  const [simResult, setSimResult] = useState<DetectionTestRunResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [ruleVersions, setRuleVersions] = useState<DetectionRuleVersion[]>([]);
  const [diffResult, setDiffResult] = useState<RuleDiffResult | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const loadRules = async () => {
    try {
      const data = await securityService.getDetectionRules();
      setRules(data);
      if (!selectedRuleId && data.length > 0) {
        setSelectedRuleId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to load detection rules', err);
    }
  };

  useEffect(() => {
    loadRules();
    const unsub = securityService.subscribe('DETECTION_RULES_UPDATED', () => {
      loadRules();
    });
    return () => unsub();
  }, []);

  const selectedRule = useMemo(() => {
    return rules.find((r) => r.id === selectedRuleId || r.ruleId === selectedRuleId) || null;
  }, [rules, selectedRuleId]);

  useEffect(() => {
    if (selectedRule) {
      setEditName(selectedRule.name);
      setEditDesc(selectedRule.description);
      setEditSeverity(selectedRule.severity);
      setEditCategory(selectedRule.category);
      setEditMitre(selectedRule.mitreTechniqueId || '');
      setEditConditions(
        Array.isArray(selectedRule.conditions)
          ? (selectedRule.conditions.filter((c) => 'field' in c) as RuleCondition[])
          : []
      );
      setValidationResult(null);
      setSimResult(null);
      setIsEditing(false);

      // Load versions
      if (selectedRule.ruleId) {
        securityService.getDetectionRuleVersions(selectedRule.ruleId).then(setRuleVersions).catch(console.error);
      }
    }
  }, [selectedRuleId, selectedRule?.updatedAt]);

  const filteredRules = useMemo(() => {
    return rules.filter((r) => {
      const matchesSearch =
        !searchTerm ||
        r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.ruleId && r.ruleId.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (r.tags && r.tags.some((t) => t.toLowerCase().includes(searchTerm.toLowerCase())));

      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ENABLED' && r.enabled) ||
        (statusFilter === 'DISABLED' && !r.enabled && r.status !== 'DEPRECATED' && r.status !== 'DRAFT') ||
        r.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [rules, searchTerm, statusFilter]);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const handleValidate = async () => {
    if (!selectedRule) return;
    try {
      const res = await securityService.validateDetectionRule(selectedRule);
      setValidationResult(res);
      if (res.valid) {
        showNotification('✓ Rule validation PASSED with 0 errors');
      } else {
        showNotification(`⚠ Validation found ${res.errors.length} errors`);
      }
    } catch (err: any) {
      showNotification(`Validation error: ${err.message}`);
    }
  };

  const handleRunSimulation = async () => {
    if (!selectedRule) return;
    setIsSimulating(true);
    try {
      const res = await securityService.testDetectionRule(selectedRule, { sampleLimit: 200 });
      setSimResult(res);
      showNotification(
        `Simulation finished: ${res.testRun.eventsMatched} matches out of ${res.testRun.eventsEvaluated} events evaluated`
      );
    } catch (err: any) {
      showNotification(`Simulation failed: ${err.message}`);
    } finally {
      setIsSimulating(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedRule) return;
    const changeDesc = prompt('Enter change description for this rule version:', 'Optimized detection logic') || '';
    try {
      await securityService.publishDetectionRule(selectedRule.id, changeDesc);
      showNotification(`✓ Rule published as version ${(selectedRule.version ?? 1) + 1}`);
      await loadRules();
    } catch (err: any) {
      showNotification(`Publication failed: ${err.message}`);
    }
  };

  const handleToggleEnable = async () => {
    if (!selectedRule) return;
    try {
      if (selectedRule.enabled) {
        await securityService.disableDetectionRule(selectedRule.id);
        showNotification('Rule DISABLED');
      } else {
        await securityService.enableDetectionRule(selectedRule.id);
        showNotification('✓ Rule ENABLED for live evaluation');
      }
      await loadRules();
    } catch (err: any) {
      showNotification(`Failed to toggle rule state: ${err.message}`);
    }
  };

  const handleDeprecate = async () => {
    if (!selectedRule) return;
    if (!confirm(`Are you sure you want to deprecate "${selectedRule.name}"?`)) return;
    try {
      await securityService.deprecateDetectionRule(selectedRule.id);
      showNotification('Rule DEPRECATED');
      await loadRules();
    } catch (err: any) {
      showNotification(`Failed to deprecate rule: ${err.message}`);
    }
  };

  const handleCreateDraft = async () => {
    try {
      const newRule = await securityService.createDetectionRuleDraft({
        name: `New Custom Detection Rule ${rules.length + 1}`,
        description: 'Analyst authored declarative detection rule',
        severity: 'MEDIUM',
        category: 'PROCESS',
        conditions: [{ field: 'category', operator: 'EQUALS', value: 'PROCESS' }],
        changeDescription: 'Initial analyst draft',
      });
      showNotification(`Created draft ${newRule.ruleId || newRule.id}`);
      await loadRules();
      setSelectedRuleId(newRule.id);
      setIsEditing(true);
    } catch (err: any) {
      showNotification(`Failed to create draft: ${err.message}`);
    }
  };

  const handleCloneDraft = async () => {
    if (!selectedRule) return;
    try {
      const cloned = await securityService.createDetectionRuleDraft({
        ruleId: `${selectedRule.ruleId || selectedRule.id}-CLONE`,
        name: `${selectedRule.name} (Clone)`,
        description: `Clone of ${selectedRule.name}: ${selectedRule.description}`,
        severity: selectedRule.severity,
        category: selectedRule.category,
        conditions: selectedRule.conditions,
        mitreTechniqueId: selectedRule.mitreTechniqueId,
        tags: [...(selectedRule.tags || []), 'cloned'],
        changeDescription: `Cloned from ${selectedRule.name} v${selectedRule.version ?? 1}`,
      });
      showNotification(`Cloned rule as draft: ${cloned.ruleId}`);
      await loadRules();
      setSelectedRuleId(cloned.id);
    } catch (err: any) {
      showNotification(`Clone failed: ${err.message}`);
    }
  };

  const handleSaveEdits = async () => {
    if (!selectedRule) return;
    try {
      await securityService.updateDetectionRuleDraft(selectedRule.id, {
        name: editName,
        description: editDesc,
        severity: editSeverity,
        category: editCategory,
        mitreTechniqueId: editMitre || undefined,
        conditions: editConditions,
      });
      setIsEditing(false);
      showNotification('✓ Detection rule updated');
      await loadRules();
    } catch (err: any) {
      showNotification(`Update failed: ${err.message}`);
    }
  };

  const handleCompareVersions = async (v1: number, v2: number) => {
    if (!selectedRule || !selectedRule.ruleId) return;
    try {
      const diff = await securityService.diffRuleVersions(selectedRule.ruleId, v1, v2);
      setDiffResult(diff);
      setActiveTab('DIFF');
    } catch (err: any) {
      showNotification(`Diff failed: ${err.message}`);
    }
  };

  const addCondition = () => {
    setEditConditions([...editConditions, { field: 'processName', operator: 'EQUALS', value: '' }]);
  };

  const removeCondition = (index: number) => {
    setEditConditions(editConditions.filter((_, idx) => idx !== index));
  };

  const updateCondition = (index: number, patch: Partial<RuleCondition>) => {
    const updated = [...editConditions];
    updated[index] = { ...updated[index], ...patch };
    setEditConditions(updated);
  };

  return (
    <div className="detection-workspace" data-perf={perfMode}>
      {/* Toast Notification */}
      {notification && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(8, 14, 26, 0.95)',
            border: '1px solid #00f0ff',
            boxShadow: '0 0 20px rgba(0, 240, 255, 0.4)',
            color: '#3dffb0',
            padding: '8px 18px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 700,
            zIndex: 100,
          }}
        >
          {notification}
        </div>
      )}

      {/* ─── 1. LEFT PANEL: Rule Library ───────────────────────────────────────── */}
      <div className="det-panel">
        <div className="det-panel-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileCode size={14} color="#00f0ff" />
            Rule Library ({filteredRules.length})
          </span>
          <button className="det-btn primary" onClick={handleCreateDraft} title="Create Draft Rule">
            <Plus size={12} /> DRAFT
          </button>
        </div>

        <div style={{ padding: '8px 12px 0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: '#64748b' }} />
            <input
              type="text"
              className="det-input"
              style={{ paddingLeft: 26 }}
              placeholder="Search rule ID, title, tag..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {['ALL', 'ENABLED', 'DRAFT', 'PUBLISHED', 'DISABLED'].map((st) => (
              <button
                key={st}
                className="det-btn"
                style={{
                  padding: '3px 8px',
                  fontSize: 9,
                  background: statusFilter === st ? 'rgba(0, 240, 255, 0.3)' : undefined,
                  borderColor: statusFilter === st ? '#00f0ff' : undefined,
                }}
                onClick={() => setStatusFilter(st)}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="det-panel-content">
          {filteredRules.map((rule) => {
            const isSelected = rule.id === selectedRuleId || rule.ruleId === selectedRuleId;
            const status = rule.status || (rule.enabled ? 'ENABLED' : 'DISABLED');
            return (
              <div
                key={rule.id}
                className={`det-rule-card ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedRuleId(rule.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: '#38bdf8', fontWeight: 700 }}>
                    {rule.ruleId || rule.id}
                  </span>
                  <span className={`det-badge badge-${status.toLowerCase()}`}>
                    {status}
                  </span>
                </div>

                <div className="det-rule-title">{rule.name}</div>

                <div className="det-rule-meta">
                  <span className={`det-badge badge-sev-${rule.severity.toLowerCase()}`}>
                    {rule.severity}
                  </span>
                  <span style={{ color: '#94a3b8' }}>v{rule.version ?? 1}</span>
                  <span style={{ color: '#64748b' }}>•</span>
                  <span style={{ color: '#94a3b8' }}>{rule.category}</span>
                  {rule.mitreTechniqueId && (
                    <span style={{ color: '#fbbf24', marginLeft: 'auto' }}>
                      {rule.mitreTechniqueId}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── 2. CENTER PANEL: Holographic Rule Canvas & Builder ────────────────── */}
      <div className="det-panel">
        <div className="det-panel-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={14} color="#00f0ff" />
            Rule Canvas: {selectedRule?.ruleId || selectedRule?.id || 'Select a Rule'}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {isEditing ? (
              <>
                <button className="det-btn primary" onClick={handleSaveEdits}>
                  Save Draft
                </button>
                <button className="det-btn" onClick={() => setIsEditing(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="det-btn"
                onClick={() => setIsEditing(true)}
                title="Edit rule metadata & conditions"
              >
                <Sliders size={12} /> Edit Rule
              </button>
            )}
          </div>
        </div>

        <div className="det-panel-content" style={{ padding: 18 }}>
          {selectedRule ? (
            <div className="det-canvas">
              {/* Node 1: Event Trigger */}
              <div className="canvas-node">
                <div className="canvas-node-header">
                  <span>1. TELEMETRY EVENT TRIGGER</span>
                  <span className="det-badge badge-draft">{selectedRule.category}</span>
                </div>
                <div style={{ fontSize: 11, color: '#e0f2fe' }}>
                  Target Category:{' '}
                  <strong style={{ color: '#38bdf8' }}>{selectedRule.category}</strong>
                </div>
                {selectedRule.eventTypes && selectedRule.eventTypes.length > 0 && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    Pre-filtered Event Types: {selectedRule.eventTypes.join(', ')}
                  </div>
                )}
              </div>

              {/* Connector */}
              <div className="canvas-connector">
                <div className="canvas-connector-line" />
              </div>

              {/* Node 2: Declarative Conditions */}
              <div className="canvas-node" style={{ borderColor: 'rgba(61, 255, 176, 0.35)' }}>
                <div className="canvas-node-header">
                  <span style={{ color: '#3dffb0' }}>2. DECLARATIVE RULE CONDITIONS</span>
                  {isEditing && (
                    <button className="det-btn" style={{ padding: '2px 6px', fontSize: 9 }} onClick={addCondition}>
                      + Condition
                    </button>
                  )}
                </div>

                {!isEditing ? (
                  <div>
                    {selectedRule.conditions.map((cond, idx) => {
                      if ('field' in cond) {
                        return (
                          <div key={idx} className="condition-row">
                            <span className="condition-field">{cond.field}</span>
                            <span className="condition-op">{cond.operator}</span>
                            <span className="condition-val">
                              {Array.isArray(cond.value)
                                ? `[${cond.value.join(', ')}]`
                                : String(cond.value ?? '')}
                            </span>
                          </div>
                        );
                      } else {
                        return (
                          <div key={idx} className="condition-row" style={{ borderColor: '#a855f7' }}>
                            <span style={{ color: '#c084fc', fontWeight: 700 }}>
                              GROUP ({cond.operator})
                            </span>
                            <span style={{ color: '#94a3b8' }}>{cond.conditions.length} child conditions</span>
                          </div>
                        );
                      }
                    })}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {editConditions.map((cond, idx) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '130px 140px 1fr 30px', gap: 6 }}>
                        <input
                          type="text"
                          className="det-input"
                          value={cond.field}
                          onChange={(e) => updateCondition(idx, { field: e.target.value })}
                          placeholder="Field (e.g. processName)"
                        />
                        <select
                          className="det-input"
                          value={cond.operator}
                          onChange={(e) => updateCondition(idx, { operator: e.target.value as any })}
                        >
                          <option value="EQUALS">EQUALS</option>
                          <option value="NOT_EQUALS">NOT_EQUALS</option>
                          <option value="CONTAINS">CONTAINS</option>
                          <option value="STARTS_WITH">STARTS_WITH</option>
                          <option value="ENDS_WITH">ENDS_WITH</option>
                          <option value="IN_LIST">IN_LIST</option>
                          <option value="GREATER_THAN_OR_EQUAL">GREATER_THAN_OR_EQUAL</option>
                          <option value="EXISTS">EXISTS</option>
                        </select>
                        <input
                          type="text"
                          className="det-input"
                          value={Array.isArray(cond.value) ? cond.value.join(', ') : String(cond.value ?? '')}
                          onChange={(e) => {
                            const val = cond.operator === 'IN_LIST'
                              ? e.target.value.split(',').map((s) => s.trim())
                              : e.target.value;
                            updateCondition(idx, { value: val });
                          }}
                          placeholder="Target Value"
                        />
                        <button
                          className="det-btn danger"
                          style={{ padding: '0 4px' }}
                          onClick={() => removeCondition(idx)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Connector */}
              <div className="canvas-connector">
                <div className="canvas-connector-line" />
              </div>

              {/* Node 3: Match & Window */}
              <div className="canvas-node">
                <div className="canvas-node-header">
                  <span>3. TEMPORAL DEDUPLICATION & THRESHOLD</span>
                  <span style={{ color: '#fbbf24' }}>
                    Threshold: {selectedRule.threshold ?? 1} | Window: {(selectedRule.timeWindowMs ?? 900000) / 1000 / 60}m
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  Fires when at least <strong>{selectedRule.threshold ?? 1}</strong> matching event occurs within{' '}
                  <strong>{(selectedRule.timeWindowMs ?? 900000) / 1000 / 60} minutes</strong>. Deduplicated by asset and user fingerprint.
                </div>
              </div>

              {/* Connector */}
              <div className="canvas-connector">
                <div className="canvas-connector-line" />
              </div>

              {/* Node 4: Alert Generation */}
              <div className="canvas-node" style={{ borderColor: 'rgba(255, 42, 109, 0.35)' }}>
                <div className="canvas-node-header">
                  <span style={{ color: '#ff2a6d' }}>4. GENERATED ALERT PREVIEW</span>
                  <span className={`det-badge badge-sev-${selectedRule.severity.toLowerCase()}`}>
                    {selectedRule.severity}
                  </span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc' }}>
                  {selectedRule.name} on &lt;TargetAsset&gt;
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                  Retains provenance: Rule ID <strong>{selectedRule.ruleId || selectedRule.id}</strong> | Version{' '}
                  <strong>v{selectedRule.version ?? 1}</strong>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: '#64748b', textAlign: 'center', marginTop: 60 }}>
              Select a detection rule from the library to inspect its canvas.
            </div>
          )}
        </div>
      </div>

      {/* ─── 3. RIGHT PANEL: Rule Inspector & Lifecycle ───────────────────────── */}
      <div className="det-panel">
        <div className="det-panel-header">
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="det-btn"
              style={{
                padding: '3px 8px',
                background: activeTab === 'INSPECTOR' ? 'rgba(0, 240, 255, 0.25)' : undefined,
              }}
              onClick={() => setActiveTab('INSPECTOR')}
            >
              Inspector
            </button>
            <button
              className="det-btn"
              style={{
                padding: '3px 8px',
                background: activeTab === 'VERSIONS' ? 'rgba(0, 240, 255, 0.25)' : undefined,
              }}
              onClick={() => setActiveTab('VERSIONS')}
            >
              Versions ({ruleVersions.length})
            </button>
            <button
              className="det-btn"
              style={{
                padding: '3px 8px',
                background: activeTab === 'DIFF' ? 'rgba(0, 240, 255, 0.25)' : undefined,
              }}
              onClick={() => setActiveTab('DIFF')}
            >
              Diff
            </button>
          </div>
          <button className="det-btn danger" style={{ padding: '3px 8px' }} onClick={onClose} title="Close Workspace">
            <X size={12} />
          </button>
        </div>

        <div className="det-panel-content">
          {selectedRule && activeTab === 'INSPECTOR' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Lifecycle Actions */}
              <div style={{ background: 'rgba(15, 23, 42, 0.7)', padding: 10, borderRadius: 6, border: '1px solid rgba(0, 240, 255, 0.2)' }}>
                <div style={{ fontSize: 10, color: '#38bdf8', fontWeight: 700, marginBottom: 8, letterSpacing: '0.08em' }}>
                  LIFECYCLE PIPELINE
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button className="det-btn" onClick={handleValidate}>
                    <CheckCircle size={12} color="#38bdf8" /> Validate
                  </button>
                  <button className="det-btn" onClick={handleRunSimulation} disabled={isSimulating}>
                    <Play size={12} color="#fbbf24" /> Simulate
                  </button>
                  <button className="det-btn primary" onClick={handlePublish}>
                    <GitBranch size={12} /> Publish v{(selectedRule.version ?? 1) + 1}
                  </button>
                  <button
                    className={`det-btn ${selectedRule.enabled ? 'danger' : 'primary'}`}
                    onClick={handleToggleEnable}
                  >
                    <Zap size={12} /> {selectedRule.enabled ? 'Disable Rule' : 'Enable Rule'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button className="det-btn" style={{ flex: 1 }} onClick={handleCloneDraft}>
                    <Copy size={12} /> Clone Draft
                  </button>
                  <button className="det-btn danger" style={{ flex: 1 }} onClick={handleDeprecate}>
                    <Trash2 size={12} /> Deprecate
                  </button>
                </div>
              </div>

              {/* Validation Result Display */}
              {validationResult && (
                <div
                  style={{
                    background: validationResult.valid ? 'rgba(61, 255, 176, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    border: `1px solid ${validationResult.valid ? 'rgba(61, 255, 176, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
                    borderRadius: 6,
                    padding: 10,
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, color: validationResult.valid ? '#3dffb0' : '#f87171' }}>
                    {validationResult.valid ? '✓ VALIDATION PASSED' : `⚠ VALIDATION FAILED (${validationResult.errors.length} errors)`}
                  </div>
                  {validationResult.errors.map((err, i) => (
                    <div key={i} style={{ fontSize: 10, color: '#f87171', marginTop: 4 }}>
                      • {err.message}
                    </div>
                  ))}
                  {validationResult.warnings.map((warn, i) => (
                    <div key={i} style={{ fontSize: 10, color: '#fbbf24', marginTop: 2 }}>
                      • Warning: {warn.message}
                    </div>
                  ))}
                </div>
              )}

              {/* Metadata Form / Inspector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 9, color: '#94a3b8' }}>RULE TITLE</label>
                  {isEditing ? (
                    <input
                      type="text"
                      className="det-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  ) : (
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc' }}>{selectedRule.name}</div>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: 9, color: '#94a3b8' }}>DESCRIPTION</label>
                  {isEditing ? (
                    <textarea
                      className="det-input"
                      rows={3}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                    />
                  ) : (
                    <div style={{ fontSize: 11, color: '#cbd5e1' }}>{selectedRule.description}</div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 9, color: '#94a3b8' }}>SEVERITY</label>
                    {isEditing ? (
                      <select
                        className="det-input"
                        value={editSeverity}
                        onChange={(e) => setEditSeverity(e.target.value as any)}
                      >
                        <option value="CRITICAL">CRITICAL</option>
                        <option value="HIGH">HIGH</option>
                        <option value="MEDIUM">MEDIUM</option>
                        <option value="LOW">LOW</option>
                      </select>
                    ) : (
                      <div className={`det-badge badge-sev-${selectedRule.severity.toLowerCase()}`}>
                        {selectedRule.severity}
                      </div>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 9, color: '#94a3b8' }}>CATEGORY</label>
                    {isEditing ? (
                      <select
                        className="det-input"
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value as any)}
                      >
                        <option value="PROCESS">PROCESS</option>
                        <option value="AUTHENTICATION">AUTHENTICATION</option>
                        <option value="NETWORK">NETWORK</option>
                        <option value="FILE">FILE</option>
                        <option value="ENDPOINT">ENDPOINT</option>
                        <option value="SECURITY_CONTROL">SECURITY_CONTROL</option>
                      </select>
                    ) : (
                      <div style={{ fontSize: 11, color: '#e0f2fe' }}>{selectedRule.category}</div>
                    )}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 9, color: '#94a3b8' }}>MITRE ATT&CK TECHNIQUE</label>
                  {isEditing ? (
                    <input
                      type="text"
                      className="det-input"
                      value={editMitre}
                      onChange={(e) => setEditMitre(e.target.value)}
                      placeholder="e.g. T1059.001"
                    />
                  ) : (
                    <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700 }}>
                      {selectedRule.mitreTechniqueId || 'None assigned'}
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: 9, color: '#94a3b8' }}>TAGS</label>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {(selectedRule.tags || []).map((t, idx) => (
                      <span key={idx} className="det-badge" style={{ background: 'rgba(0, 240, 255, 0.1)', color: '#00f0ff' }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>
                  Author: {selectedRule.author || 'System'} | Created: {selectedRule.createdAt?.slice(0, 10)}
                </div>
              </div>
            </div>
          )}

          {/* Versions Tab */}
          {activeTab === 'VERSIONS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>
                Historical immutable releases for {selectedRule?.ruleId}:
              </div>
              {ruleVersions.map((v) => (
                <div key={v.id} className="diff-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 800, color: '#3dffb0' }}>Version {v.version}</span>
                    <span style={{ fontSize: 9, color: '#94a3b8' }}>{v.publishedAt?.slice(0, 16)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4 }}>
                    {v.changeDescription}
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                    {selectedRule && v.version !== selectedRule.version && (
                      <button
                        className="det-btn"
                        style={{ padding: '2px 8px', fontSize: 9 }}
                        onClick={() => handleCompareVersions(v.version, selectedRule.version ?? 1)}
                      >
                        Diff vs Current (v{selectedRule.version})
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {ruleVersions.length === 0 && (
                <div style={{ color: '#64748b', fontSize: 11 }}>No historical releases published yet.</div>
              )}
            </div>
          )}

          {/* Diff Tab */}
          {activeTab === 'DIFF' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {diffResult ? (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#00f0ff' }}>
                    Structural Diff: v{diffResult.fromVersion} → v{diffResult.toVersion}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{diffResult.summary}</div>

                  {diffResult.changes.map((ch, idx) => (
                    <div key={idx} className="diff-item">
                      <div className="diff-field">{ch.field}</div>
                      <div className="diff-old">
                        - {typeof ch.oldValue === 'object' ? JSON.stringify(ch.oldValue) : String(ch.oldValue)}
                      </div>
                      <div className="diff-new">
                        + {typeof ch.newValue === 'object' ? JSON.stringify(ch.newValue) : String(ch.newValue)}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ color: '#64748b', fontSize: 11 }}>Select two versions in the Versions tab to compare.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── 4. BOTTOM PANEL: Simulation & Test Harness ──────────────────────── */}
      <div className="det-panel" style={{ gridColumn: '1 / -1' }}>
        <div className="det-panel-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Play size={13} color="#fbbf24" />
            Dry-Run Rule Simulation (Zero Side-Effects)
          </span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>
              Target: {selectedRule?.name ? `"${selectedRule.name}" (v${selectedRule.version ?? 1})` : 'None'}
            </span>
            <button
              className="det-btn primary"
              onClick={handleRunSimulation}
              disabled={!selectedRule || isSimulating}
            >
              {isSimulating ? <RefreshCw className="spin" size={12} /> : <Play size={12} />} Run Simulation Test
            </button>
          </div>
        </div>

        <div className="det-panel-content" style={{ padding: 12 }}>
          {simResult ? (
            <div className="sim-grid">
              {/* Metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className="sim-metric-box">
                  <div className="sim-metric-val">{simResult.testRun.eventsEvaluated}</div>
                  <div className="sim-metric-label">Events Evaluated</div>
                </div>
                <div className="sim-metric-box">
                  <div className="sim-metric-val" style={{ color: simResult.testRun.eventsMatched > 0 ? '#ff2a6d' : '#3dffb0' }}>
                    {simResult.testRun.eventsMatched}
                  </div>
                  <div className="sim-metric-label">Events Matched</div>
                </div>
                <div className="sim-metric-box">
                  <div className="sim-metric-val">{simResult.testRun.executionTimeMs}ms</div>
                  <div className="sim-metric-label">Execution Time</div>
                </div>
                <div className="sim-metric-box">
                  <div className="sim-metric-val" style={{ color: '#00f0ff' }}>
                    0
                  </div>
                  <div className="sim-metric-label">Production Alerts (Pure)</div>
                </div>
              </div>

              {/* Match Details List */}
              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {simResult.explanations.slice(0, 8).map((exp, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: exp.matched ? 'rgba(255, 42, 109, 0.1)' : 'rgba(15, 23, 42, 0.6)',
                      border: `1px solid ${exp.matched ? 'rgba(255, 42, 109, 0.4)' : 'rgba(0, 240, 255, 0.1)'}`,
                      borderRadius: 4,
                      padding: '6px 10px',
                      fontSize: 10,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, color: exp.matched ? '#ff2a6d' : '#94a3b8' }}>
                        {exp.matched ? '✓ MATCHED' : '• NOT MATCHED'}: Event {exp.eventId}
                      </span>
                    </div>
                    <div style={{ color: '#cbd5e1', marginTop: 2 }}>{exp.explanation}</div>
                    <div style={{ color: '#64748b', fontSize: 9, marginTop: 2 }}>
                      {exp.contributingConditions.join(' | ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', fontSize: 11, gap: 8 }}>
              <Play size={16} /> Click "Run Simulation Test" to evaluate this detection rule against canonical security events in real-time.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
