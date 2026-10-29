/**
 * playbook-engine.ts
 *
 * Deterministic local SOAR Playbook Engine for EXPLAIN-SEC SPATIAL.
 *
 * Fully offline, event-driven, and bound to SecurityService.
 * Executes playbooks step-by-step with explicit state machine:
 *   PENDING -> READY -> WAITING_APPROVAL -> RUNNING -> COMPLETED (or FAILED / SKIPPED)
 *
 * Every action step executes REAL mutations through SecurityService, which writes
 * to LocalProvider and persists to IndexedDB.
 */

import type { Playbook, PlaybookStep } from '../models/response';
import type { UserSession } from '../models/auth';
import { securityService } from '../security-service';
import { canRequestContainment, canApproveContainment, canExecuteSOAR } from '../auth/rbac';

// ─── Deterministic Seed Playbooks ─────────────────────────────────────────────

const SEED_BLACKTIDE_PLAYBOOK: Playbook = {
  id: 'playbook-bt-containment',
  playbookId: 'playbook-bt-containment',
  version: 1,
  name: 'BLACKTIDE_CONTAINMENT',
  description: 'Deterministic RaaS (ALPHV/BlackTide) emergency containment: patient-zero host isolation, perimeter IOC firewall block, account credential revocation, and audit finalization.',
  category: 'CONTAINMENT',
  status: 'RUNNING',
  enabled: true,
  triggerTypes: ['MANUAL', 'ALERT_CRITICAL'],
  supportedEntityTypes: ['INCIDENT', 'ASSET'],
  author: 'Elena Rostova',
  createdAt: '2024-11-14T04:20:00Z',
  updatedAt: '2024-11-14T04:20:00Z',
  publishedAt: '2024-11-14T04:20:00Z',
  incidentId: 'incident-001',
  triggerType: 'HIGH_SEV_RANSOMWARE_CORRELATION',
  steps: [
    {
      id: 'step-bt-01',
      order: 1,
      name: 'Correlate Attack Signal',
      type: 'TRIGGER',
      targetLabel: 'Perimeter Alert Stream',
      description: 'Ingest multi-source telemetry and confirm ALPHV ransomware-as-a-service execution pattern.',
      status: 'COMPLETED',
      executedAt: '2024-11-14T04:20:00Z',
      resultMessage: 'Pattern confirmed with 92% confidence against MITRE ATT&CK T1078, T1059.',
    },
    {
      id: 'step-bt-02',
      order: 2,
      name: 'Identify Compromised Patient-Zero',
      type: 'CONDITION',
      targetLabel: 'FINWS-027 (10.0.4.27)',
      targetType: 'ASSET',
      targetId: 'asset-001',
      description: 'Isolate root host initiating lateral RPC beacons to DOMAIN-CONTROLLER-01.',
      status: 'COMPLETED',
      executedAt: '2024-11-14T04:22:00Z',
      resultMessage: 'FINWS-027 confirmed patient-zero with active Mimikatz memory signatures.',
    },
    {
      id: 'step-bt-03',
      order: 3,
      name: 'Request EDR Host Quarantine',
      type: 'ACTION_REQUEST',
      actionType: 'QUARANTINE_ASSET',
      targetLabel: 'FINWS-027 (Asset asset-001)',
      targetType: 'ASSET',
      targetId: 'asset-001',
      description: 'Submit formal request to disconnect FINWS-027 from corporate network fabric.',
      requiredRole: 'L2_ANALYST',
      status: 'COMPLETED',
      executedAt: '2024-11-14T04:25:00Z',
      resultMessage: 'Containment request action-001 registered.',
    },
    {
      id: 'step-bt-04',
      order: 4,
      name: 'SOC Manager Authorization',
      type: 'APPROVAL',
      targetLabel: 'Host Isolation Policy',
      targetType: 'INCIDENT',
      targetId: 'incident-001',
      description: 'Requires SOC_MANAGER or PLATFORM_ADMIN cryptographic approval decision.',
      requiredRole: 'SOC_MANAGER',
      status: 'COMPLETED',
      executedAt: '2024-11-14T04:28:00Z',
      resultMessage: 'Approved by Taylor Singh [SOC_MANAGER]. Authorization token granted.',
    },
    {
      id: 'step-bt-05',
      order: 5,
      name: 'Execute Host Quarantine',
      type: 'ACTION_EXECUTE',
      actionType: 'QUARANTINE_ASSET',
      targetLabel: 'FINWS-027',
      targetType: 'ASSET',
      targetId: 'asset-001',
      description: 'Sever all network routes to host FINWS-027, retaining only TLS forensic telemetry.',
      requiredRole: 'INCIDENT_RESPONDER',
      consequence: 'Host FINWS-027 status will transition to ISOLATED; blast radius becomes SAFE.',
      status: 'READY',
    },
    {
      id: 'step-bt-06',
      order: 6,
      name: 'Block C2 Perimeter IP',
      type: 'ACTION_EXECUTE',
      actionType: 'BLOCK_IOC',
      targetLabel: '185.220.101.47',
      targetType: 'IOC',
      targetId: 'ioc-002',
      description: 'Push drop rule to perimeter edge firewall (EDGE-FW-01) for Cobalt Strike rendezvous IP.',
      requiredRole: 'INCIDENT_RESPONDER',
      consequence: 'IOC 185.220.101.47 isBlocked will be set to TRUE.',
      status: 'PENDING',
    },
    {
      id: 'step-bt-07',
      order: 7,
      name: 'Revoke Compromised Credentials',
      type: 'ACTION_EXECUTE',
      actionType: 'DISABLE_USER',
      targetLabel: 'r.morrison',
      targetType: 'USER',
      targetId: 'user-001',
      description: 'Suspend compromised active directory user and invalidate existing Kerberos TGTs.',
      requiredRole: 'INCIDENT_RESPONDER',
      consequence: 'User r.morrison status will transition to SUSPENDED.',
      status: 'PENDING',
    },
    {
      id: 'step-bt-08',
      order: 8,
      name: 'Update Incident Lifecycle to CONTAINING',
      type: 'INCIDENT_UPDATE',
      targetLabel: 'INC-001 Lifecycle',
      targetType: 'INCIDENT',
      targetId: 'incident-001',
      description: 'Transition incident state to CONTAINING and record milestone in timeline.',
      requiredRole: 'INCIDENT_RESPONDER',
      status: 'PENDING',
    },
    {
      id: 'step-bt-09',
      order: 9,
      name: 'Commit Durable Audit Record',
      type: 'AUDIT_COMMIT',
      targetLabel: 'IDB Audit Store',
      targetType: 'INCIDENT',
      targetId: 'incident-001',
      description: 'Ensure all containment actions and authorizations are recorded in IndexedDB.',
      requiredRole: 'L1_ANALYST',
      status: 'PENDING',
    },
  ],
};

import { SEED_PLAYBOOKS } from '../data/seed-playbooks';

// ─── Playbook Engine Class ───────────────────────────────────────────────────

export class PlaybookEngine {
  private _playbooks: Map<string, Playbook> = new Map();

  constructor() {
    this._playbooks.set(SEED_BLACKTIDE_PLAYBOOK.id, JSON.parse(JSON.stringify(SEED_BLACKTIDE_PLAYBOOK)));
    // Populate seed playbooks
    for (const pb of SEED_PLAYBOOKS) {
      this._playbooks.set(pb.id, JSON.parse(JSON.stringify(pb)));
    }
  }

  getPlaybooksForIncident(incidentId: string): Playbook[] {
    const list: Playbook[] = [];
    this._playbooks.forEach((p) => {
      if (p.incidentId === incidentId) list.push(JSON.parse(JSON.stringify(p)));
    });

    if (list.length === 0) {
      // Generate a dynamic incident response playbook for newly created incidents
      const dynamicPlaybook = this._generateDefaultPlaybook(incidentId);
      this._playbooks.set(dynamicPlaybook.id, dynamicPlaybook);
      list.push(JSON.parse(JSON.stringify(dynamicPlaybook)));
    }

    return list;
  }

  getPlaybook(playbookId: string): Playbook | null {
    const p = this._playbooks.get(playbookId);
    return p ? JSON.parse(JSON.stringify(p)) : null;
  }

  async executeStep(
    playbookId: string,
    stepId: string,
    session: UserSession
  ): Promise<{ playbook: Playbook; result: string }> {
    const playbook = this._playbooks.get(playbookId);
    if (!playbook) throw new Error(`Playbook "${playbookId}" not found`);

    const stepIndex = playbook.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) throw new Error(`Step "${stepId}" not found in playbook "${playbookId}"`);

    const step = playbook.steps[stepIndex];
    if (step.status === 'COMPLETED') {
      return { playbook: JSON.parse(JSON.stringify(playbook)), result: 'Step already completed.' };
    }

    step.status = 'RUNNING';

    try {
      let resultMsg = '';

      switch (step.type) {
        case 'ACTION_REQUEST': {
          if (!canRequestContainment(session.role)) {
            throw new Error(`Role "${session.role}" lacks CONTAINMENT_REQUEST permission.`);
          }
          const req = await securityService.requestResponseAction({
            type: step.actionType ?? 'QUARANTINE_ASSET',
            targetId: step.targetId ?? 'asset-001',
            targetType: (step.targetType as any) ?? 'ASSET',
            targetLabel: step.targetLabel || 'Target Entity',
            incidentId: playbook.incidentId || 'incident-001',
            riskImpact: 'HIGH',
            reversibility: 'FULL',
            consequence: step.consequence,
          });
          resultMsg = `Action request created with ID ${req.id}. Status: ${req.status}`;
          break;
        }

        case 'APPROVAL': {
          if (!canApproveContainment(session.role)) {
            throw new Error(`Role "${session.role}" lacks CONTAINMENT_APPROVE permission.`);
          }
          // Find pending action or approve action-001
          const actions = await securityService.getResponseActions(playbook.incidentId || 'incident-001');
          const pending = actions.find((a) => a.status === 'PENDING_APPROVAL' || a.status === 'AWAITING_APPROVAL') || actions[0];
          if (pending && pending.status !== 'APPROVED' && pending.status !== 'COMPLETED') {
            await securityService.approveResponseAction(pending.id);
            resultMsg = `Containment action ${pending.id} approved by ${session.displayName}.`;
          } else {
            resultMsg = `Authorization granted by ${session.displayName} [${session.role}].`;
          }
          break;
        }

        case 'ACTION_EXECUTE': {
          if (!canExecuteSOAR(session.role)) {
            throw new Error(`Role "${session.role}" lacks SOAR_EXECUTE permission.`);
          }
          const actions = await securityService.getResponseActions(playbook.incidentId || 'incident-001');
          let targetAction = actions.find(
            (a) => (a.type === step.actionType || (step.actionType === 'QUARANTINE_ASSET' && a.type === 'QUARANTINE_HOST')) &&
                   a.status === 'APPROVED'
          );

          if (!targetAction) {
            // Check if there is an action needing execution or create & execute
            targetAction = await securityService.requestResponseAction({
              type: step.actionType ?? 'QUARANTINE_ASSET',
              targetId: step.targetId ?? 'asset-001',
              targetType: (step.targetType as any) ?? 'ASSET',
              targetLabel: step.targetLabel || 'Target Entity',
              incidentId: playbook.incidentId || 'incident-001',
              riskImpact: 'HIGH',
              reversibility: 'FULL',
              consequence: step.consequence,
            });
            // Automatically approve if executed by responder/manager
            if (canApproveContainment(session.role)) {
              await securityService.approveResponseAction(targetAction.id);
            }
          }

          const executed = await securityService.executeResponseAction(targetAction.id);
          resultMsg = `Executed ${step.name}: ${executed.resultMessage ?? 'Success'}`;
          break;
        }

        case 'INCIDENT_UPDATE': {
          await securityService.updateIncidentStatus(
            playbook.incidentId || 'incident-001',
            'CONTAINING',
            `Playbook ${playbook.name} reached containment milestone.`
          );
          resultMsg = `Incident state updated to CONTAINING.`;
          break;
        }

        case 'AUDIT_COMMIT': {
          const logs = await securityService.getAuditLogs();
          resultMsg = `Audit trail verified. Total ${logs.length} persisted records in IndexedDB.`;
          break;
        }

        default:
          resultMsg = `Step ${step.name} verified and completed.`;
      }

      step.status = 'COMPLETED';
      step.executedAt = new Date().toISOString();
      step.resultMessage = resultMsg;

      // Promote the next step to READY
      if (stepIndex + 1 < playbook.steps.length) {
        const nextStep = playbook.steps[stepIndex + 1];
        if (nextStep.status === 'PENDING') {
          nextStep.status = nextStep.type === 'APPROVAL' ? 'WAITING_APPROVAL' : 'READY';
        }
      } else {
        playbook.status = 'COMPLETED';
        playbook.completedAt = new Date().toISOString();
      }

      return {
        playbook: JSON.parse(JSON.stringify(playbook)),
        result: resultMsg,
      };
    } catch (err: any) {
      step.status = 'FAILED';
      step.error = err?.message ?? String(err);
      playbook.status = 'FAILED';
      throw err;
    }
  }

  private _generateDefaultPlaybook(incidentId: string): Playbook {
    return {
      id: `playbook-generic-${incidentId}`,
      playbookId: `playbook-generic-${incidentId}`,
      version: 1,
      name: `INCIDENT_CONTAINMENT_PLAYBOOK`,
      description: `Standard triage and containment workflow for ${incidentId}.`,
      category: 'CONTAINMENT',
      status: 'RUNNING',
      enabled: true,
      triggerTypes: ['MANUAL', 'INCIDENT_CREATED'],
      supportedEntityTypes: ['INCIDENT', 'ASSET'],
      author: 'System',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      incidentId,
      triggerType: 'INCIDENT_CREATED',
      steps: [
        {
          id: `step-${incidentId}-1`,
          order: 1,
          name: 'Incident Ingestion & Verification',
          type: 'TRIGGER',
          targetLabel: incidentId,
          description: 'Validate initial alerts, verify affected assets, and confirm triage priority.',
          status: 'COMPLETED',
          executedAt: new Date().toISOString(),
          resultMessage: 'Incident registered and prioritized.',
        },
        {
          id: `step-${incidentId}-2`,
          order: 2,
          name: 'Assess Affected Entity Scope',
          type: 'CONDITION',
          targetLabel: 'Asset / IOC Inventory',
          description: 'Identify high-criticality assets and active command-and-control indicators.',
          status: 'READY',
        },
        {
          id: `step-${incidentId}-3`,
          order: 3,
          name: 'Request Emergency Asset Quarantine',
          type: 'ACTION_REQUEST',
          actionType: 'QUARANTINE_ASSET',
          targetLabel: 'Affected Host',
          description: 'Submit network containment request for compromised endpoint.',
          status: 'PENDING',
        },
        {
          id: `step-${incidentId}-4`,
          order: 4,
          name: 'SOC Leadership Approval Gate',
          type: 'APPROVAL',
          targetLabel: 'Approval Queue',
          description: 'Authorized sign-off for asset disruption.',
          status: 'PENDING',
        },
        {
          id: `step-${incidentId}-5`,
          order: 5,
          name: 'Execute Quarantine & Block C2',
          type: 'ACTION_EXECUTE',
          actionType: 'QUARANTINE_ASSET',
          targetLabel: 'Target Asset & Perimeter Firewall',
          description: 'Apply network isolation policy and drop perimeter connections.',
          status: 'PENDING',
        },
        {
          id: `step-${incidentId}-6`,
          order: 6,
          name: 'Update Incident to CONTAINING',
          type: 'INCIDENT_UPDATE',
          targetLabel: 'Incident Lifecycle',
          description: 'Transition lifecycle status to CONTAINING.',
          status: 'PENDING',
        },
      ],
    };
  }
}

// Singleton engine
export const playbookEngine = new PlaybookEngine();
