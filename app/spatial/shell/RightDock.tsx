/**
 * app/spatial/shell/RightDock.tsx
 *
 * Right Flank Dock & Launcher System.
 *
 * Manages Asset Environment Posture and SOAR Response Operations.
 * Protects consequential actions (Isolate Asset, Execute Playbook, Approve SOAR)
 * through the two-stage SecurityActionConfirmModal gate.
 * When closed, renders a compact vertical Launcher Strip on the right edge.
 */

'use client';
import { useState } from 'react';
import {
  Server,
  Zap,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  Activity,
  ShieldCheck,
} from 'lucide-react';
import { DockablePanel } from './DockablePanel';
import { useSpatialUi, RightDockTab } from '../state/use-spatial-ui';
import { securityService } from '../../core/security-service';
import { cyberAudio } from '../../cyber-audio';
import type { Asset } from '../../core/models/entity';
import type { ResponseAction } from '../../core/models/response';

export interface RightDockProps {
  assets: Asset[];
  responseActions: ResponseAction[];
  soarStats: {
    activeExecutions: number;
    awaitingApproval: number;
    completedExecutions: number;
    failedExecutions: number;
    recentExecutions: any[];
  };
  onSelectAsset?: (assetId: string) => void;
  onRefreshData?: () => void;
}

export function RightDock({
  assets,
  responseActions,
  soarStats,
  onSelectAsset,
  onRefreshData,
}: RightDockProps) {
  const {
    rightPanelVisible,
    rightDockTab,
    setRightDockTab,
    setRightPanelVisible,
    requestConfirmation,
  } = useSpatialUi();

  // Status counts
  const compromisedCount = assets.filter((a) => a.status === 'COMPROMISED').length;
  const isolatedCount = assets.filter((a) => a.status === 'ISOLATED').length;
  const suspiciousCount = assets.filter((a) => a.status === 'SUSPICIOUS').length;
  const healthyCount = assets.filter((a) => a.status === 'HEALTHY').length;

  const handleIsolateAsset = (asset: Asset) => {
    cyberAudio.playClick();
    requestConfirmation({
      id: `isolate-${asset.id}-${Date.now()}`,
      title: `CONFIRM ASSET CONTAINMENT`,
      description: `Immediately isolate endpoint ${asset.hostname} from the corporate network, terminating all active network sockets and blocking lateral egress.`,
      targetId: asset.id,
      targetLabel: `${asset.hostname} (${asset.ipAddress})`,
      actionType: 'ISOLATE_ASSET',
      riskTier: 'HIGH',
      requiredRole: 'SENIOR_ANALYST',
      onConfirm: async () => {
        await securityService.requestResponseAction({
          type: 'ISOLATE_ASSET',
          targetType: 'ASSET',
          targetId: asset.id,
          targetLabel: `${asset.hostname} (${asset.ipAddress})`,
          incidentId: 'incident-001',
          riskImpact: 'HIGH',
          reversibility: 'FULL',
          requiresApproval: false,
        });
        cyberAudio.playLockAcquired();
        onRefreshData?.();
      },
      onCancel: () => {},
    });
  };

  const handleRestoreAsset = (asset: Asset) => {
    cyberAudio.playClick();
    requestConfirmation({
      id: `restore-${asset.id}-${Date.now()}`,
      title: `CONFIRM ASSET NETWORK RESTORATION`,
      description: `Restore network connectivity for ${asset.hostname}. Ensure all active malware processes and IOCs have been purged prior to restoration.`,
      targetId: asset.id,
      targetLabel: `${asset.hostname} (${asset.ipAddress})`,
      actionType: 'RESTORE_ASSET',
      riskTier: 'MEDIUM',
      requiredRole: 'SENIOR_ANALYST',
      onConfirm: async () => {
        await securityService.requestResponseAction({
          type: 'RESTORE_ASSET',
          targetType: 'ASSET',
          targetId: asset.id,
          targetLabel: `${asset.hostname} (${asset.ipAddress})`,
          incidentId: 'incident-001',
          riskImpact: 'MEDIUM',
          reversibility: 'FULL',
          requiresApproval: false,
        });
        cyberAudio.playLockAcquired();
        onRefreshData?.();
      },
      onCancel: () => {},
    });
  };

  const handleApproveSoar = (actionId: string, label: string) => {
    cyberAudio.playClick();
    requestConfirmation({
      id: `soar-appr-${actionId}-${Date.now()}`,
      title: `AUTHORIZE SOAR PLAYBOOK ACTION`,
      description: `Approve execution of automated security response action "${label}". This will execute containment commands immediately.`,
      targetId: actionId,
      targetLabel: label,
      actionType: 'APPROVE_SOAR',
      riskTier: 'HIGH',
      requiredRole: 'COMMANDER',
      onConfirm: async () => {
        await securityService.approveResponseAction(actionId);
        cyberAudio.playLockAcquired();
        onRefreshData?.();
      },
      onCancel: () => {},
    });
  };

  // If dock is closed, render compact vertical launcher strip on right edge
  if (!rightPanelVisible) {
    return (
      <aside className="dock-launcher-strip right-strip" aria-label="Right Dock Launcher">
        <button
          className={`launcher-btn ${rightDockTab === 'ASSETS' ? 'active' : ''}`}
          onClick={() => {
            cyberAudio.playClick();
            setRightDockTab('ASSETS');
          }}
          title="Open Asset Posture Panel [HotKey: ]]"
        >
          <Server size={13} className="text-cyan" />
          <span className="launcher-label">ASSETS</span>
          <span className="launcher-counter" style={{ color: compromisedCount > 0 ? '#ff2a2a' : '#3dffb0' }}>
            {compromisedCount}
          </span>
        </button>

        <button
          className={`launcher-btn ${rightDockTab === 'SOAR' ? 'active' : ''}`}
          onClick={() => {
            cyberAudio.playClick();
            setRightDockTab('SOAR');
          }}
          title="Open SOAR Response Panel"
        >
          <Zap size={13} className="text-amber" />
          <span className="launcher-label">SOAR</span>
          <span className="launcher-counter">{soarStats.awaitingApproval}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="spatial-dock-container right-dock-container" aria-label="Asset and SOAR Response Dock">
      <DockablePanel
        id="right-dock"
        title={rightDockTab === 'ASSETS' ? 'ASSET POSTURE' : 'SOAR RESPONSE PIPELINE'}
        icon={rightDockTab === 'ASSETS' ? <Server size={13} /> : <Zap size={13} />}
        isOpen={rightPanelVisible}
        onClose={() => setRightPanelVisible(false)}
        actions={
          <div className="dock-tab-pills">
            <button
              className={`dock-tab-btn ${rightDockTab === 'ASSETS' ? 'active' : ''}`}
              onClick={() => {
                cyberAudio.playClick();
                setRightDockTab('ASSETS');
              }}
            >
              ASSETS ({assets.length})
            </button>
            <button
              className={`dock-tab-btn ${rightDockTab === 'SOAR' ? 'active' : ''}`}
              onClick={() => {
                cyberAudio.playClick();
                setRightDockTab('SOAR');
              }}
            >
              SOAR ({soarStats.activeExecutions + soarStats.awaitingApproval})
            </button>
          </div>
        }
      >
        {/* Tab 1: Asset Posture */}
        {rightDockTab === 'ASSETS' && (
          <div className="dock-tab-content">
            {/* Status Grid */}
            <div className="dock-stat-grid stat-cols-4">
              <div className="dock-stat-cell">
                <strong className="stat-val" style={{ color: compromisedCount > 0 ? '#ff2a2a' : '#3dffb0' }}>
                  {compromisedCount}
                </strong>
                <span className="stat-lbl">COMPROMISED</span>
              </div>
              <div className="dock-stat-cell">
                <strong className="stat-val text-amber">{isolatedCount}</strong>
                <span className="stat-lbl">ISOLATED</span>
              </div>
              <div className="dock-stat-cell">
                <strong className="stat-val text-yellow">{suspiciousCount}</strong>
                <span className="stat-lbl">SUSPICIOUS</span>
              </div>
              <div className="dock-stat-cell">
                <strong className="stat-val text-ok">{healthyCount}</strong>
                <span className="stat-lbl">HEALTHY</span>
              </div>
            </div>

            {/* Asset Items List */}
            <div className="dock-cards-scroll">
              {assets.map((asset) => {
                const isComp = asset.status === 'COMPROMISED';
                const isIsol = asset.status === 'ISOLATED';
                const statusColor = isComp ? '#ff2a2a' : isIsol ? '#ffb700' : '#3dffb0';

                return (
                  <article
                    key={asset.id}
                    className={`dock-card asset-card ${isComp ? 'is-critical' : ''}`}
                    onClick={() => onSelectAsset?.(asset.id)}
                    tabIndex={0}
                    role="button"
                  >
                    <div className="card-top-row">
                      <strong className="asset-hostname">{asset.hostname}</strong>
                      <span className="card-sev-tag" style={{ borderColor: statusColor, color: statusColor }}>
                        {asset.status}
                      </span>
                    </div>

                    <div className="card-meta-line">
                      <span>IP: {asset.ipAddress}</span>
                      <span>OS: {asset.os}</span>
                      <span>CRIT: {asset.criticality}</span>
                    </div>

                    <div className="card-action-bar" onClick={(e) => e.stopPropagation()}>
                      {isIsol ? (
                        <button
                          className="card-quick-btn restore-btn"
                          onClick={() => handleRestoreAsset(asset)}
                          title="Restore endpoint network connectivity (Requires confirmation)"
                        >
                          <Unlock size={10} /> RESTORE
                        </button>
                      ) : (
                        <button
                          className="card-quick-btn isolate-btn"
                          onClick={() => handleIsolateAsset(asset)}
                          title="Isolate host from network (Requires confirmation)"
                        >
                          <Lock size={10} /> ISOLATE
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: SOAR Pipeline */}
        {rightDockTab === 'SOAR' && (
          <div className="dock-tab-content">
            {/* Status Grid */}
            <div className="dock-stat-grid stat-cols-4">
              <div className="dock-stat-cell">
                <strong className="stat-val text-cyan">{soarStats.activeExecutions}</strong>
                <span className="stat-lbl">ACTIVE</span>
              </div>
              <div className="dock-stat-cell">
                <strong className="stat-val text-amber">{soarStats.awaitingApproval}</strong>
                <span className="stat-lbl">APPROVAL</span>
              </div>
              <div className="dock-stat-cell">
                <strong className="stat-val text-ok">{soarStats.completedExecutions}</strong>
                <span className="stat-lbl">COMPLETED</span>
              </div>
              <div className="dock-stat-cell">
                <strong className="stat-val" style={{ color: soarStats.failedExecutions > 0 ? '#ff4242' : '#64748b' }}>
                  {soarStats.failedExecutions}
                </strong>
                <span className="stat-lbl">FAILED</span>
              </div>
            </div>

            {/* Actions & Executions List */}
            <div className="dock-cards-scroll">
              {responseActions.length === 0 && soarStats.recentExecutions.length === 0 ? (
                <div className="dock-empty">No active SOAR executions.</div>
              ) : (
                <>
                  {responseActions.map((ra) => {
                    const isPending = ra.status === 'PENDING_APPROVAL' || ra.status === 'REQUESTED';

                    return (
                      <article key={ra.id} className={`dock-card soar-card ${isPending ? 'needs-approval' : ''}`}>
                        <div className="card-top-row">
                          <span className="card-id">{ra.type}</span>
                          <span className="card-sev-tag text-amber">{ra.status}</span>
                        </div>
                        <div className="soar-target">TARGET: {ra.targetLabel}</div>

                        {isPending && (
                          <div className="card-action-bar">
                            <button
                              className="card-quick-btn approve-btn"
                              onClick={() => handleApproveSoar(ra.id, `${ra.type} on ${ra.targetLabel}`)}
                              title="Authorize containment action (Requires confirmation)"
                            >
                              <ShieldCheck size={10} /> APPROVE ACTION
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}

                  {soarStats.recentExecutions.map((exec) => (
                    <article key={exec.id} className="dock-card soar-exec-card">
                      <div className="card-top-row">
                        <span className="card-id">{exec.playbookName}</span>
                        <span className="card-sev-tag" style={{ color: exec.status === 'COMPLETED' ? '#3dffb0' : '#ffb700' }}>
                          {exec.status}
                        </span>
                      </div>
                      <div className="card-meta-line">
                        <span>OPERATOR: {exec.executedBy}</span>
                        <span>{new Date(exec.startedAt).toLocaleTimeString()}</span>
                      </div>
                    </article>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </DockablePanel>
    </aside>
  );
}
