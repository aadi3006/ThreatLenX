/**
 * rule-validator.ts
 *
 * Deterministic, offline Detection Rule Validator for EXPLAIN-SEC SPATIAL.
 *
 * Checks:
 * - Structural completeness (name, category, severity, conditions).
 * - Supported event fields and operators.
 * - Value types and operator compatibility.
 * - MITRE ATT&CK technique formatting and canonical catalog presence.
 * - Threshold and time window numeric validity.
 * - Non-empty logical condition groups.
 *
 * Pure functions, zero network, zero eval().
 */

import type {
  DetectionRule,
  RuleCondition,
  RuleConditionGroup,
  RuleValidationResult,
  ValidationError,
  ValidationWarning,
  RuleConditionOperator,
} from '../models/detection';
import type { EventCategory, Severity } from '../models';

export const SUPPORTED_EVENT_FIELDS = new Set([
  'id',
  'timestamp',
  'source',
  'sourceType',
  'category',
  'eventType',
  'severity',
  'assetId',
  'userId',
  'message',
  'rawPayload',
  'iocIds',
  'processName',
  'commandLine',
  'parentProcessName',
  'destinationIp',
  'sourceIp',
  'destinationPort',
  'sourcePort',
  'domain',
  'filePath',
  'registryKey',
  'targetUser',
  'mitreTechniqueId',
  'metadata',
]);

export const SUPPORTED_OPERATORS = new Set<string>([
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'NOT_CONTAINS',
  'STARTS_WITH',
  'ENDS_WITH',
  'GREATER_THAN',
  'LESS_THAN',
  'GREATER_THAN_OR_EQUAL',
  'LESS_THAN_OR_EQUAL',
  'IN_LIST',
  'NOT_IN_LIST',
  'EXISTS',
  // lowercase equivalents
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'greaterThan',
  'lessThan',
  'greaterThanOrEqual',
  'lessThanOrEqual',
  'in',
  'notIn',
  'exists',
]);

export const VALID_CATEGORIES = new Set<EventCategory>([
  'AUTHENTICATION',
  'PROCESS',
  'NETWORK',
  'FILE',
  'ENDPOINT',
  'SECURITY_CONTROL',
]);

export const VALID_SEVERITIES = new Set<Severity>([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFO',
]);

export const CANONICAL_MITRE_TECHNIQUES = new Set([
  'T1566',
  'T1566.001',
  'T1204',
  'T1204.002',
  'T1059',
  'T1059.001',
  'T1547',
  'T1547.001',
  'T1098',
  'T1003',
  'T1003.001',
  'T1110',
  'T1110.001',
  'T1018',
  'T1078',
  'T1078.002',
  'T1021',
  'T1560',
  'T1560.001',
  'T1071',
  'T1071.001',
  'T1048',
  'T1048.003',
  'T1490',
]);

function isConditionGroup(c: RuleCondition | RuleConditionGroup): c is RuleConditionGroup {
  return 'operator' in c && ('conditions' in c || (c as any).operator === 'AND' || (c as any).operator === 'OR');
}

function validateSingleCondition(
  cond: RuleCondition,
  index: number,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const condPath = `${path}[${index}]`;

  // 1. Field validation
  if (!cond.field || typeof cond.field !== 'string' || cond.field.trim().length === 0) {
    errors.push({
      field: `${condPath}.field`,
      message: 'Condition field name is missing or empty',
      code: 'MISSING_CONDITION_FIELD',
    });
    return;
  }

  const baseField = cond.field.split('.')[0];
  if (!SUPPORTED_EVENT_FIELDS.has(baseField) && !cond.field.startsWith('metadata.')) {
    errors.push({
      field: `${condPath}.field`,
      message: `Condition contains unsupported event field "${cond.field}"`,
      code: 'UNSUPPORTED_EVENT_FIELD',
    });
  }

  // 2. Operator validation
  if (!cond.operator || typeof cond.operator !== 'string') {
    errors.push({
      field: `${condPath}.operator`,
      message: 'Condition operator is missing or invalid',
      code: 'MISSING_CONDITION_OPERATOR',
    });
    return;
  }

  if (!SUPPORTED_OPERATORS.has(cond.operator)) {
    errors.push({
      field: `${condPath}.operator`,
      message: `Condition contains unsupported operator "${cond.operator}"`,
      code: 'UNSUPPORTED_OPERATOR',
    });
    return;
  }

  const opUpper = cond.operator.toUpperCase();

  // 3. Value validation based on operator
  if (opUpper === 'EXISTS') {
    // Value is not required for EXISTS
    return;
  }

  if (cond.value === undefined || cond.value === null) {
    errors.push({
      field: `${condPath}.value`,
      message: `Condition with operator "${cond.operator}" requires a non-null target value`,
      code: 'MISSING_CONDITION_VALUE',
    });
    return;
  }

  if (opUpper === 'IN_LIST' || opUpper === 'NOT_IN_LIST' || (cond.operator as string) === 'in' || (cond.operator as string) === 'notIn') {
    if (!Array.isArray(cond.value) || cond.value.length === 0) {
      errors.push({
        field: `${condPath}.value`,
        message: `Condition operator "${cond.operator}" requires a non-empty array of values`,
        code: 'INVALID_LIST_VALUE',
      });
    }
  }

  if (
    opUpper === 'GREATER_THAN' ||
    opUpper === 'LESS_THAN' ||
    opUpper === 'GREATER_THAN_OR_EQUAL' ||
    opUpper === 'LESS_THAN_OR_EQUAL'
  ) {
    const num = Number(cond.value);
    if (isNaN(num)) {
      errors.push({
        field: `${condPath}.value`,
        message: `Numeric comparison operator "${cond.operator}" requires a numeric value`,
        code: 'NON_NUMERIC_COMPARISON_VALUE',
      });
    }
  }
}

function validateConditionsRecursive(
  items: (RuleCondition | RuleConditionGroup)[],
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  if (!items || items.length === 0) {
    errors.push({
      field: path,
      message: 'Rule must define at least one valid condition',
      code: 'EMPTY_CONDITIONS',
    });
    return;
  }

  items.forEach((item, idx) => {
    if (isConditionGroup(item)) {
      if (item.operator !== 'AND' && item.operator !== 'OR') {
        errors.push({
          field: `${path}[${idx}].operator`,
          message: `Logical condition group operator must be 'AND' or 'OR' (got "${item.operator}")`,
          code: 'INVALID_GROUP_OPERATOR',
        });
      }
      if (!item.conditions || item.conditions.length === 0) {
        errors.push({
          field: `${path}[${idx}].conditions`,
          message: 'Condition group cannot be empty',
          code: 'EMPTY_CONDITION_GROUP',
        });
      } else {
        validateConditionsRecursive(item.conditions, `${path}[${idx}].conditions`, errors, warnings);
      }
    } else {
      validateSingleCondition(item, idx, path, errors, warnings);
    }
  });
}

/**
 * Validates a detection rule deterministically.
 */
export function validateRule(rule: Partial<DetectionRule>): RuleValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. Name validation
  if (!rule.name || typeof rule.name !== 'string' || rule.name.trim().length === 0) {
    errors.push({
      field: 'name',
      message: 'Rule name is required',
      code: 'MISSING_NAME',
    });
  } else if (rule.name.length < 3) {
    errors.push({
      field: 'name',
      message: 'Rule name must be at least 3 characters long',
      code: 'NAME_TOO_SHORT',
    });
  }

  // 2. Description
  if (!rule.description || typeof rule.description !== 'string' || rule.description.trim().length === 0) {
    warnings.push({
      field: 'description',
      message: 'Rule has no description or analyst triage guidance',
      code: 'MISSING_DESCRIPTION',
    });
  }

  // 3. Category validation
  if (!rule.category || !VALID_CATEGORIES.has(rule.category)) {
    errors.push({
      field: 'category',
      message: `Invalid or missing event category "${rule.category}"`,
      code: 'INVALID_CATEGORY',
    });
  }

  // 4. Severity validation
  if (!rule.severity || !VALID_SEVERITIES.has(rule.severity)) {
    errors.push({
      field: 'severity',
      message: `Invalid or missing severity "${rule.severity}"`,
      code: 'INVALID_SEVERITY',
    });
  }

  // 5. Conditions validation
  if (!rule.conditions || !Array.isArray(rule.conditions) || rule.conditions.length === 0) {
    errors.push({
      field: 'conditions',
      message: 'Rule must define at least one detection condition',
      code: 'MISSING_CONDITIONS',
    });
  } else {
    validateConditionsRecursive(rule.conditions, 'conditions', errors, warnings);
  }

  // 6. Threshold & TimeWindow validation
  if (rule.threshold !== undefined) {
    if (typeof rule.threshold !== 'number' || rule.threshold < 1 || !Number.isInteger(rule.threshold)) {
      errors.push({
        field: 'threshold',
        message: 'Threshold must be a positive integer >= 1',
        code: 'INVALID_THRESHOLD',
      });
    }
  }

  if (rule.timeWindowMs !== undefined) {
    if (typeof rule.timeWindowMs !== 'number' || rule.timeWindowMs < 1000) {
      errors.push({
        field: 'timeWindowMs',
        message: 'Time window must be at least 1,000ms (1 second)',
        code: 'INVALID_TIME_WINDOW',
      });
    }
  }

  // 7. MITRE Technique Validation
  if (!rule.mitreTechniqueId && (!rule.mitreTechniqueIds || rule.mitreTechniqueIds.length === 0)) {
    warnings.push({
      field: 'mitreTechniqueId',
      message: 'Rule has no associated MITRE ATT&CK technique mapping',
      code: 'MISSING_MITRE_MAPPING',
    });
  } else {
    const techniques = [
      ...(rule.mitreTechniqueId ? [rule.mitreTechniqueId] : []),
      ...(rule.mitreTechniqueIds ?? []),
    ];

    for (const tech of techniques) {
      if (!CANONICAL_MITRE_TECHNIQUES.has(tech)) {
        // Warning rather than blocking error if formatted like a technique
        if (/^T\d{4}(\.\d{3})?$/.test(tech)) {
          warnings.push({
            field: 'mitreTechniqueId',
            message: `Technique "${tech}" is validly formatted but not present in local canonical MITRE matrix`,
            code: 'NON_CANONICAL_MITRE_TECHNIQUE',
          });
        } else {
          errors.push({
            field: 'mitreTechniqueId',
            message: `Invalid MITRE ATT&CK technique ID format: "${tech}" (expected e.g. T1059.001)`,
            code: 'INVALID_MITRE_FORMAT',
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}
