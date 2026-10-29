/**
 * CreateIncidentModal.tsx
 *
 * Real offline incident creation modal dialog.
 * Creates canonical Incident objects persisted in IndexedDB through SecurityService.
 */

'use client';
import { useState, useEffect } from 'react';
import { Plus, X, AlertTriangle, ShieldCheck, ShieldAlert, Check } from 'lucide-react';
import type { Severity, CreateIncidentInput } from '../../core/models/incident';
import type { Asset } from '../../core/models/entity';
import { securityService } from '../../core/security-service';
import { canCreateIncident } from '../../core/auth/rbac';
import { cyberAudio } from '../../cyber-audio';

interface CreateIncidentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIncidentCreated?: (incidentId: string) => void;
}

export default function CreateIncidentModal({
  isOpen,
  onClose,
  onIncidentCreated,
}: CreateIncidentModalProps) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<Severity>('HIGH');
  const [riskScore, setRiskScore] = useState<number>(75);
  const [summary, setSummary] = useState('');
  const [detectionDesc, setDetectionDesc] = useState('');
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const session = securityService.getSession();
  const userCanCreate = session ? canCreateIncident(session.role) : false;

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    securityService.getAssets().then(setAvailableAssets).catch(console.error);
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleAsset = (assetId: string) => {
    setSelectedAssets((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('Incident title is required.');
      return;
    }

    if (!userCanCreate) {
      setErrorMsg(`Role "${session?.role ?? 'UNKNOWN'}" lacks INCIDENT_CREATE permission.`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    cyberAudio.playClick();

    try {
      const input: CreateIncidentInput = {
        title: title.trim(),
        severity,
        riskScore,
        summary: summary.trim() || undefined,
        affectedAssets: selectedAssets,
        initialDetectionDescription: detectionDesc.trim() || undefined,
      };

      const newInc = await securityService.createIncident(input);
      cyberAudio.playSuccess?.();
      onIncidentCreated?.(newInc.id);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Failed to create incident');
      cyberAudio.playAlert?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="resp-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="resp-modal-card"
        style={{ maxWidth: 580 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="resp-modal-title">
            <Plus size={18} color="#00f0ff" />
            <span>CREATE CANONICAL INCIDENT [OFFLINE]</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* RBAC notice */}
        <div
          style={{
            fontSize: 10,
            padding: '6px 10px',
            borderRadius: 4,
            background: userCanCreate ? 'rgba(61,255,176,0.1)' : 'rgba(255,42,42,0.1)',
            border: `1px solid ${userCanCreate ? '#3dffb040' : '#ff2a2a40'}`,
            color: userCanCreate ? '#3dffb0' : '#ff6b6b',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {userCanCreate ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}
          <span>
            OPERATOR: <strong>{session?.displayName}</strong> ({session?.role}) —{' '}
            {userCanCreate ? 'AUTHORIZED TO CREATE' : 'UNAUTHORIZED (INCIDENT_CREATE REQUIRED)'}
          </span>
        </div>

        {errorMsg && (
          <div
            style={{
              fontSize: 11,
              padding: '8px 12px',
              borderRadius: 4,
              background: 'rgba(255,42,42,0.15)',
              border: '1px solid #ff2a2a',
              color: '#ff8888',
            }}
          >
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="resp-modal-row">
            <label className="resp-modal-label">INCIDENT TITLE *</label>
            <input
              type="text"
              className="resp-modal-val"
              placeholder="e.g. Cobalt Strike Beaconing on Host-04"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ border: '1px solid rgba(255,255,255,0.15)', outline: 'none' }}
              autoFocus
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="resp-modal-row">
              <label className="resp-modal-label">SEVERITY</label>
              <select
                className="resp-modal-val"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                style={{ border: '1px solid rgba(255,255,255,0.15)', outline: 'none', background: '#0a101f' }}
              >
                <option value="CRITICAL">CRITICAL</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
                <option value="INFO">INFO</option>
              </select>
            </div>

            <div className="resp-modal-row">
              <label className="resp-modal-label">RISK SCORE (0-100)</label>
              <input
                type="number"
                min={0}
                max={100}
                className="resp-modal-val"
                value={riskScore}
                onChange={(e) => setRiskScore(Number(e.target.value))}
                style={{ border: '1px solid rgba(255,255,255,0.15)', outline: 'none' }}
              />
            </div>
          </div>

          <div className="resp-modal-row">
            <label className="resp-modal-label">AFFECTED ASSETS</label>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                maxHeight: 110,
                overflowY: 'auto',
                padding: 6,
                background: 'rgba(0,0,0,0.3)',
                borderRadius: 4,
              }}
            >
              {availableAssets.map((asset) => {
                const isSelected = selectedAssets.includes(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => toggleAsset(asset.id)}
                    style={{
                      fontSize: 10,
                      padding: '4px 8px',
                      borderRadius: 3,
                      background: isSelected ? 'rgba(0,240,255,0.2)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${isSelected ? '#00f0ff' : 'rgba(255,255,255,0.1)'}`,
                      color: isSelected ? '#00f0ff' : '#94a3b8',
                      cursor: 'pointer',
                    }}
                  >
                    {asset.name} ({asset.ipAddress})
                  </button>
                );
              })}
            </div>
          </div>

          <div className="resp-modal-row">
            <label className="resp-modal-label">SUMMARY & EVIDENCE SUMMARY</label>
            <textarea
              className="resp-modal-val"
              rows={2}
              placeholder="Initial triage summary and observed indicators..."
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              style={{ border: '1px solid rgba(255,255,255,0.15)', outline: 'none', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
            <button
              type="button"
              className="resp-btn"
              onClick={onClose}
              style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              CANCEL
            </button>
            <button
              type="submit"
              className="resp-btn resp-btn-primary"
              disabled={isSubmitting || !userCanCreate}
            >
              <Check size={12} /> {isSubmitting ? 'CREATING…' : 'CREATE INCIDENT'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
