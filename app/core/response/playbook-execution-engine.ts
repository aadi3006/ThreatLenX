/**
 * playbook-execution-engine.ts
 *
 * Reusable Offline SOAR Playbook Execution Engine for EXPLAIN-SEC SPATIAL.
 * Manages the full lifecycle of playbook instances:
 *   QUEUED -> RUNNING -> WAITING_APPROVAL -> COMPLETED (or FAILED / CANCELLED)
 *
 * Features:
 *   - Step-by-step or automated execution of actions from the Action Catalog
 *   - Approval workflows with role verification
 *   - True side-effect free Dry-Run simulation
 *   - Reversible step compensation (rollback)
 *   - Recovery across browser reload
 */

import type {
  Playbook,
  PlaybookStep,
  PlaybookExecution,
  PlaybookStepExecution,
  ApprovalRecord,
  DryRunResult,
  DryRunSimulatedStep,
  ResponseActionType,
  ResponseTargetType,
} from '../models/response';
import type { RoleId } from '../models/auth';
import { getActionDefinition } from './action-catalog';
import { validatePlaybook } from './playbook-validator';

export interface ExecutionEngineStores {
  assets: any[];
  users: any[];
  iocs: any[];
  incidents: any[];
  alerts: any[];
  cases: any[];
  evidence: any[];
  events: any[];
  audit_records: any[];
  [key: string]: any[];
}

export class PlaybookExecutionEngine {
  /**
   * Initialize a new PlaybookExecution instance from a Playbook definition.
   */
  createExecution(
    playbook: Playbook,
    triggerSource: any,
    actor: string,
    actorRole: RoleId,
    options?: {
      incidentId?: string;
      alertId?: string;
      caseId?: string;
      targetEntity?: { id: string; type: ResponseTargetType; label: string };
      isDryRun?: boolean;
    }
  ): PlaybookExecution {
    const executionId = `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const stepExecutions: PlaybookStepExecution[] = playbook.steps.map((step, idx) => ({
      id: `step-exec-${executionId}-${idx + 1}`,
      stepId: step.id,
      order: step.order ?? idx + 1,
      name: step.name,
      type: step.type,
      actionType: step.actionType,
      targetType: step.targetType,
      targetId: step.targetId ?? options?.targetEntity?.id,
      targetLabel: step.targetLabel ?? options?.targetEntity?.label,
      status: idx === 0 ? (step.type === 'APPROVAL' ? 'WAITING_APPROVAL' : 'READY') : 'PENDING',
      parameters: step.parameters,
      requiresApproval: step.requiresApproval || step.type === 'APPROVAL',
    }));

    return {
      id: executionId,
      playbookId: playbook.playbookId || playbook.id,
      playbookVersion: playbook.version || 1,
      playbookName: playbook.name,
      triggerSource: triggerSource || 'MANUAL',
      incidentId: options?.incidentId || playbook.incidentId,
      alertId: options?.alertId,
      caseId: options?.caseId,
      targetEntity: options?.targetEntity,
      status: 'QUEUED',
      currentStepIndex: 0,
      stepExecutions,
      startedAt: new Date().toISOString(),
      initiatedBy: actor,
      initiatedByRole: actorRole,
      isDryRun: !!options?.isDryRun,
      idempotencyKey: `${playbook.id}-${options?.incidentId || 'global'}-${Date.now()}`,
    };
  }

  /**
   * Execute or advance a single step in a PlaybookExecution.
   */
  async executeStep(
    execution: PlaybookExecution,
    stepId: string,
    actor: string,
    actorRole: RoleId,
    stores: ExecutionEngineStores,
    onApprovalRequired?: (approval: ApprovalRecord) => Promise<void>
  ): Promise<{ execution: PlaybookExecution; message: string }> {
    if (execution.status === 'COMPLETED' || execution.status === 'CANCELLED') {
      return { execution, message: `Execution is already ${execution.status}.` };
    }

    const stepIndex = execution.stepExecutions.findIndex((s) => s.stepId === stepId || s.id === stepId);
    if (stepIndex === -1) {
      throw new Error(`Step "${stepId}" not found in execution "${execution.id}"`);
    }

    const step = execution.stepExecutions[stepIndex];
    if (step.status === 'COMPLETED') {
      return { execution, message: `Step "${step.name}" already completed.` };
    }

    execution.status = 'RUNNING';
    execution.currentStepIndex = stepIndex;

    // 1. Approval Gate
    if (step.requiresApproval && step.status !== 'READY') {
      step.status = 'WAITING_APPROVAL';
      execution.status = 'WAITING_APPROVAL';

      const approvalId = `appr-${execution.id}-${step.stepId}`;
      const approval: ApprovalRecord = {
        id: approvalId,
        executionId: execution.id,
        stepId: step.stepId,
        actionType: step.actionType ?? 'ISOLATE_ASSET',
        targetType: step.targetType ?? 'INCIDENT',
        targetId: step.targetId ?? execution.incidentId ?? 'target',
        targetLabel: step.targetLabel ?? 'Target Entity',
        riskImpact: 'HIGH',
        requestedBy: actor,
        requestedByRole: actorRole,
        requestedAt: new Date().toISOString(),
        status: 'PENDING',
      };
      step.approvalId = approvalId;

      if (onApprovalRequired) {
        await onApprovalRequired(approval);
      }

      return {
        execution,
        message: `Step "${step.name}" paused waiting for leadership authorization.`,
      };
    }

    // 2. Execute Action
    step.status = 'RUNNING';
    step.startedAt = new Date().toISOString();

    try {
      let resultMsg = '';

      if (step.actionType) {
        const actionDef = getActionDefinition(step.actionType);
        if (!actionDef) {
          throw new Error(`Unsupported action type: "${step.actionType}"`);
        }

        const targetId = step.targetId || execution.incidentId || '';
        const params = step.parameters || {};

        // Validation
        const validation = actionDef.validate(targetId, params, stores);
        if (!validation.valid) {
          throw new Error(`Validation failed for ${step.name}: ${validation.error}`);
        }

        // Execution
        const execResult = await actionDef.execute(
          targetId,
          params,
          {
            actor,
            actorRole,
            incidentId: execution.incidentId,
            alertId: execution.alertId,
            caseId: execution.caseId,
            isDryRun: execution.isDryRun,
          },
          stores
        );

        resultMsg = execResult.message;

        // Verification
        const verification = await actionDef.verify(targetId, params, stores);
        if (!verification.verified && !execution.isDryRun) {
          throw new Error(`Post-execution verification failed: ${verification.message}`);
        }
      } else {
        resultMsg = `Step "${step.name}" completed.`;
      }

      step.status = 'COMPLETED';
      step.completedAt = new Date().toISOString();
      step.resultMessage = resultMsg;

      // Promote next step
      if (stepIndex + 1 < execution.stepExecutions.length) {
        const nextStep = execution.stepExecutions[stepIndex + 1];
        if (nextStep.status === 'PENDING') {
          nextStep.status = nextStep.requiresApproval ? 'WAITING_APPROVAL' : 'READY';
          if (nextStep.status === 'WAITING_APPROVAL') {
            execution.status = 'WAITING_APPROVAL';
          }
        }
        execution.currentStepIndex = stepIndex + 1;
      } else {
        execution.status = 'COMPLETED';
        execution.completedAt = new Date().toISOString();
      }

      return { execution, message: resultMsg };
    } catch (err: any) {
      step.status = 'FAILED';
      step.error = err?.message ?? String(err);
      execution.status = 'FAILED';
      execution.error = step.error;
      throw err;
    }
  }

  /**
   * Side-effect free Dry-Run simulation of a playbook.
   */
  dryRunPlaybook(
    playbook: Playbook,
    stores: ExecutionEngineStores,
    actor: string,
    targetOverride?: { id: string; type: ResponseTargetType; label: string }
  ): DryRunResult {
    const validation = validatePlaybook(playbook);
    const simulatedSteps: DryRunSimulatedStep[] = [];
    const warnings = [...validation.warnings];
    const errors = [...validation.errors];

    for (const step of playbook.steps) {
      const targetId = step.targetId || targetOverride?.id || playbook.incidentId || 'target';
      let wouldExecute = true;
      let expectedStateChange = 'No state mutation';
      let reversibility = 'REVERSIBLE' as any;

      if (step.actionType) {
        const actionDef = getActionDefinition(step.actionType);
        if (actionDef) {
          reversibility = actionDef.reversibility;
          const sim = actionDef.simulate(targetId, step.parameters || {}, stores);
          expectedStateChange = sim.expectedStateChange;
          wouldExecute = sim.wouldModify;
        } else {
          warnings.push(`Step "${step.name}" has unknown actionType "${step.actionType}".`);
        }
      }

      simulatedSteps.push({
        stepId: step.id,
        name: step.name,
        actionType: step.actionType,
        target: step.targetLabel || targetId,
        wouldExecute,
        requiresApproval: !!step.requiresApproval || step.type === 'APPROVAL',
        expectedStateChange,
        reversibility,
      });
    }

    return {
      playbookId: playbook.playbookId || playbook.id,
      playbookVersion: playbook.version || 1,
      valid: validation.valid,
      simulatedSteps,
      warnings,
      errors,
      executedBy: actor,
      simulatedAt: new Date().toISOString(),
    };
  }

  /**
   * Rollback completed reversible steps in reverse order.
   */
  async rollbackExecution(
    execution: PlaybookExecution,
    actor: string,
    actorRole: RoleId,
    stores: ExecutionEngineStores
  ): Promise<{ execution: PlaybookExecution; compensatedStepsCount: number }> {
    let count = 0;
    const completedSteps = [...execution.stepExecutions]
      .filter((s) => s.status === 'COMPLETED' && s.actionType)
      .reverse();

    for (const step of completedSteps) {
      if (!step.actionType) continue;
      const actionDef = getActionDefinition(step.actionType);
      if (actionDef && actionDef.reversibility === 'REVERSIBLE' && actionDef.compensate) {
        const targetId = step.targetId || execution.incidentId || '';
        try {
          const compResult = await actionDef.compensate(
            targetId,
            undefined,
            { actor, actorRole, incidentId: execution.incidentId },
            stores
          );
          step.compensatedAt = new Date().toISOString();
          step.compensationResultMessage = compResult.message;
          count++;
        } catch (err: any) {
          step.error = `Compensation failed: ${err?.message ?? String(err)}`;
        }
      }
    }

    execution.status = 'CANCELLED';
    return { execution, compensatedStepsCount: count };
  }
}

export const playbookExecutionEngine = new PlaybookExecutionEngine();
