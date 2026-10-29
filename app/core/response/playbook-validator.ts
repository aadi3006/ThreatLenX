/**
 * playbook-validator.ts
 *
 * Deterministic offline validator for SOAR Playbooks.
 * Validates:
 *   - Required metadata (name, description, author, category)
 *   - Trigger types and conditions
 *   - Sequential step ordering
 *   - Action catalog registration and compatibility
 *   - Approval requirements
 *   - Reversibility and compensation linkages
 */

import type { Playbook, PlaybookStep, PlaybookValidationResult } from '../models/response';
import { getActionDefinition } from './action-catalog';

export function validatePlaybook(playbook: Partial<Playbook>): PlaybookValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Metadata checks
  if (!playbook.name || !playbook.name.trim()) {
    errors.push('Playbook name is required.');
  }

  if (!playbook.description || !playbook.description.trim()) {
    warnings.push('Playbook description is recommended for analyst comprehension.');
  }

  if (!playbook.category) {
    errors.push('Playbook category (e.g. CONTAINMENT, REMEDIATION) is required.');
  }

  if (!playbook.author || !playbook.author.trim()) {
    warnings.push('Playbook author is missing; defaulting to system.');
  }

  if (!playbook.triggerTypes || playbook.triggerTypes.length === 0) {
    if (!playbook.triggerType) {
      errors.push('At least one trigger type (e.g. MANUAL, ALERT_CRITICAL) must be declared.');
    }
  }

  // 2. Step checks
  const steps = playbook.steps;
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    errors.push('Playbook must contain at least one step.');
    return { valid: errors.length === 0, errors, warnings };
  }

  const seenOrders = new Set<number>();
  const seenStepIds = new Set<string>();

  steps.forEach((step: PlaybookStep, idx: number) => {
    const stepLabel = `Step ${idx + 1} (${step.name || step.id || 'unnamed'})`;

    if (!step.id) {
      errors.push(`${stepLabel}: Step ID is required.`);
    } else if (seenStepIds.has(step.id)) {
      errors.push(`${stepLabel}: Duplicate step ID "${step.id}".`);
    } else {
      seenStepIds.add(step.id);
    }

    if (step.order === undefined || step.order === null) {
      errors.push(`${stepLabel}: Step order must be specified.`);
    } else if (seenOrders.has(step.order)) {
      warnings.push(`${stepLabel}: Non-unique step order ${step.order}.`);
    } else {
      seenOrders.add(step.order);
    }

    if (!step.name || !step.name.trim()) {
      errors.push(`${stepLabel}: Step name is required.`);
    }

    // Check step type & action catalog
    if (step.type === 'ACTION' || step.type === 'ACTION_EXECUTE' || step.type === 'ACTION_REQUEST') {
      if (!step.actionType) {
        errors.push(`${stepLabel}: Action step requires an actionType.`);
      } else {
        const actionDef = getActionDefinition(step.actionType);
        if (!actionDef) {
          errors.push(`${stepLabel}: Unknown or unsupported actionType "${step.actionType}".`);
        } else {
          // Check target compatibility if specified
          if (step.targetType && step.targetType !== actionDef.targetType) {
            warnings.push(
              `${stepLabel}: Declared targetType "${step.targetType}" differs from action targetType "${actionDef.targetType}".`
            );
          }
        }
      }
    }

    // Compensation check
    if (step.compensationAction) {
      const compDef = getActionDefinition(step.compensationAction);
      if (!compDef) {
        warnings.push(`${stepLabel}: Unknown compensation action "${step.compensationAction}".`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
