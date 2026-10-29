/**
 * ResponseAuditStream.tsx
 *
 * Real-time view of persisted response audit records.
 * Provides transparent verification that every containment decision, approval,
 * and execution is committed durably to IndexedDB.
 */

'use client';
import { useState, useEffect } from 'react';
import { ShieldCheck, Clock, User } from 'lucide-react';
import type { AuditRecord } from '../../core/models/audit';
import { securityService } from '../../core/security-service';

interface ResponseAuditStreamProps {
  incidentId: string;
}

export default function ResponseAuditStream({ incidentId }: ResponseAuditStreamProps) {
  const [records, setRecords] = useState<AuditRecord[]>([]);

  const loadAuditRecords = async () => {
    const logs = await securityService.getAuditLogs();
    // Filter records related to this incident or response actions
    const relevant = logs.filter(
      (l) =>
        l.target.includes(incidentId) ||
        (l.details as Record<string, unknown>)?.incidentId === incidentId ||
        l.action.includes('RESPONSE') ||
        l.action.includes('CONTAINMENT') ||
        l.action.includes('INCIDENT')
    );
    setRecords(relevant.reverse());
  };

  useEffect(() => {
    void loadAuditRecords();
    const unsub = securityService.subscribe('AUDIT_APPENDED', () => {
      void loadAuditRecords();
    });
    return unsub;
  }, [incidentId]);

  return (
    <div className="audit-stream-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#00f0ff', letterSpacing: '0.08em' }}>
          DURABLE AUDIT LOG ({records.length} RECORDS)
        </span>
        <span style={{ fontSize: 10, color: '#64748b' }}>
          TAMPER-EVIDENT LOCAL IDB STORE
        </span>
      </div>

      {records.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 11 }}>
          No audit records recorded for this incident yet.
        </div>
      ) : (
        records.map((r) => (
          <div key={r.id} className="audit-entry-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShieldCheck size={14} color="#3dffb0" />
              <div>
                <span className="audit-action-tag">{r.action}</span>
                <span style={{ color: '#94a3b8', marginLeft: 8 }}>
                  Target: <span style={{ color: '#e2e8f0' }}>{r.target}</span>
                </span>
                {r.resultingState && (
                  <span style={{ color: '#64748b', marginLeft: 6 }}>
                    → {r.resultingState}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="audit-actor-tag" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <User size={11} /> {r.actor} ({r.actorRole})
              </span>
              <span className="audit-time" style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Clock size={10} /> {new Date(r.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
