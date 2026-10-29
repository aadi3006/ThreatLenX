/**
 * detection-engine.ts
 *
 * Deterministic, side-effect free local Detection Engine for EXPLAIN-SEC SPATIAL.
 *
 * Implements:
 * - Declarative rule condition evaluation (NO eval(), Function(), or code generation).
 * - Fast applicability pre-filtering.
 * - Deterministic alert fingerprinting and deduplication.
 * - Canonical Alert generation and occurrence aggregation.
 * - Alert local querying, filtering, and statistical metrics.
 *
 * 100% offline, pure functions, zero external calls.
 */

import type { SecurityEvent } from '../models/event';
import type {
  DetectionRule,
  RuleCondition,
  RuleConditionGroup,
  Alert,
  AlertStatus,
  AlertQuery,
  AlertStats,
  TestRunOptions,
  DetectionTestRun,
  DetectionTestRunResult,
  DetectionTestMatchExplanation,
  RuleDiffResult,
  RuleDiffFieldChange,
  CreateDetectionRuleInput,
} from '../models/detection';
import type { ThreatHuntQuery } from '../models/hunting';
import { simpleHash } from './event-engine';

export type RuleEvaluationResult = 'MATCH' | 'NO_MATCH' | 'INVALID';

/**
 * Extracts a field value from a SecurityEvent, supporting nested metadata keys.
 */
export function getFieldValue(event: SecurityEvent, fieldPath: string): unknown {
  if (!event || !fieldPath) return undefined;

  // Direct top-level property
  if (fieldPath in event) {
    return (event as unknown as Record<string, unknown>)[fieldPath];
  }

  // Nested property (e.g. 'metadata.sender')
  if (fieldPath.includes('.')) {
    const parts = fieldPath.split('.');
    let current: unknown = event;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  // Check metadata dictionary directly
  if (event.metadata && fieldPath in event.metadata) {
    return event.metadata[fieldPath];
  }

  return undefined;
}

export function isConditionGroup(
  c: RuleCondition | RuleConditionGroup
): c is RuleConditionGroup {
  return 'operator' in c && ('conditions' in c || (c as any).operator === 'AND' || (c as any).operator === 'OR');
}

/**
 * Pure evaluator for a single declarative rule condition against a SecurityEvent.
 */
export function evaluateCondition(condition: RuleCondition, event: SecurityEvent): boolean {
  if (!condition || !condition.field || !condition.operator) {
    return false;
  }

  const rawValue = getFieldValue(event, condition.field);
  const op = String(condition.operator).toUpperCase();

  switch (op) {
    case 'EXISTS': {
      if (rawValue === undefined || rawValue === null) return false;
      if (Array.isArray(rawValue)) return rawValue.length > 0;
      if (typeof rawValue === 'string') return rawValue.trim().length > 0;
      return true;
    }

    case 'EQUALS': {
      if (rawValue === undefined || rawValue === null) return false;
      const targetStr = String(condition.value).toLowerCase();
      const actualStr = String(rawValue).toLowerCase();
      return actualStr === targetStr;
    }

    case 'NOT_EQUALS': {
      if (rawValue === undefined || rawValue === null) return true;
      const targetStr = String(condition.value).toLowerCase();
      const actualStr = String(rawValue).toLowerCase();
      return actualStr !== targetStr;
    }

    case 'CONTAINS': {
      if (rawValue === undefined || rawValue === null) return false;
      const targetStr = String(condition.value).toLowerCase();
      if (Array.isArray(rawValue)) {
        return rawValue.some((item) => String(item).toLowerCase().includes(targetStr));
      }
      return String(rawValue).toLowerCase().includes(targetStr);
    }

    case 'NOT_CONTAINS': {
      if (rawValue === undefined || rawValue === null) return true;
      const targetStr = String(condition.value).toLowerCase();
      if (Array.isArray(rawValue)) {
        return !rawValue.some((item) => String(item).toLowerCase().includes(targetStr));
      }
      return !String(rawValue).toLowerCase().includes(targetStr);
    }

    case 'STARTS_WITH': {
      if (rawValue === undefined || rawValue === null) return false;
      const targetStr = String(condition.value).toLowerCase();
      return String(rawValue).toLowerCase().startsWith(targetStr);
    }

    case 'ENDS_WITH': {
      if (rawValue === undefined || rawValue === null) return false;
      const targetStr = String(condition.value).toLowerCase();
      return String(rawValue).toLowerCase().endsWith(targetStr);
    }

    case 'GREATER_THAN': {
      const numActual = Number(rawValue);
      const numTarget = Number(condition.value);
      if (isNaN(numActual) || isNaN(numTarget)) return false;
      return numActual > numTarget;
    }

    case 'LESS_THAN': {
      const numActual = Number(rawValue);
      const numTarget = Number(condition.value);
      if (isNaN(numActual) || isNaN(numTarget)) return false;
      return numActual < numTarget;
    }

    case 'GREATER_THAN_OR_EQUAL': {
      const numActual = Number(rawValue);
      const numTarget = Number(condition.value);
      if (isNaN(numActual) || isNaN(numTarget)) return false;
      return numActual >= numTarget;
    }

    case 'LESS_THAN_OR_EQUAL': {
      const numActual = Number(rawValue);
      const numTarget = Number(condition.value);
      if (isNaN(numActual) || isNaN(numTarget)) return false;
      return numActual <= numTarget;
    }

    case 'IN':
    case 'IN_LIST': {
      if (rawValue === undefined || rawValue === null || !Array.isArray(condition.value)) return false;
      const actualStr = String(rawValue).toLowerCase();
      return condition.value.some((v) => String(v).toLowerCase() === actualStr);
    }

    case 'NOT_IN':
    case 'NOT_IN_LIST': {
      if (rawValue === undefined || rawValue === null) return true;
      if (!Array.isArray(condition.value)) return false;
      const actualStr = String(rawValue).toLowerCase();
      return !condition.value.some((v) => String(v).toLowerCase() === actualStr);
    }

    default:
      return false;
  }
}

/**
 * Recursively evaluates an item which may be a single condition or a condition group.
 */
export function evaluateConditionItem(
  item: RuleCondition | RuleConditionGroup,
  event: SecurityEvent
): boolean {
  if (isConditionGroup(item)) {
    return evaluateConditionGroup(item, event);
  }
  return evaluateCondition(item, event);
}

/**
 * Evaluates a condition group with AND/OR logic and optional negation.
 */
export function evaluateConditionGroup(
  group: RuleConditionGroup,
  event: SecurityEvent
): boolean {
  if (!group || !group.conditions || group.conditions.length === 0) {
    return false;
  }
  const isOr = group.operator === 'OR';
  let matched = isOr ? false : true;

  for (const child of group.conditions) {
    const res = evaluateConditionItem(child, event);
    if (isOr) {
      if (res) {
        matched = true;
        break;
      }
    } else {
      if (!res) {
        matched = false;
        break;
      }
    }
  }

  return group.negate ? !matched : matched;
}

/**
 * Explains why a condition matched or failed against an event.
 */
export function explainCondition(
  condition: RuleCondition,
  event: SecurityEvent
): { matched: boolean; text: string } {
  const matched = evaluateCondition(condition, event);
  const actual = getFieldValue(event, condition.field);
  const actualStr = actual === undefined ? 'undefined' : typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  const expectedStr = Array.isArray(condition.value) ? `[${condition.value.join(', ')}]` : String(condition.value);

  if (matched) {
    return {
      matched: true,
      text: `[${condition.field} ${condition.operator} ${expectedStr}] (actual: "${actualStr}")`,
    };
  } else {
    return {
      matched: false,
      text: `[${condition.field} ${condition.operator} ${expectedStr}] FAILED (actual: "${actualStr}")`,
    };
  }
}

/**
 * Evaluates a detection rule against a single SecurityEvent.
 * Side-effect free, deterministic, and safe.
 */
export function evaluateRule(rule: DetectionRule, event: SecurityEvent): RuleEvaluationResult {
  if (!rule || !event) {
    return 'INVALID';
  }

  // 1. Rule must be enabled
  if (!rule.enabled) {
    return 'NO_MATCH';
  }

  // 2. Event type pre-filter
  if (rule.eventTypes && rule.eventTypes.length > 0) {
    const matchesEventType = rule.eventTypes.some(
      (et) => et.toUpperCase() === event.eventType.toUpperCase()
    );
    if (!matchesEventType) {
      return 'NO_MATCH';
    }
  }

  // 3. Category pre-filter (unless rule is generalized across security controls)
  if (rule.category && rule.category !== 'SECURITY_CONTROL') {
    if (rule.category !== event.category && event.category !== 'SECURITY_CONTROL') {
      return 'NO_MATCH';
    }
  }

  // 4. Conditions evaluation (handles both flat conditions and nested groups)
  if (!rule.conditions || rule.conditions.length === 0) {
    return 'NO_MATCH';
  }

  for (const cond of rule.conditions) {
    const isMatched = evaluateConditionItem(cond, event);
    if (!isMatched) {
      return 'NO_MATCH';
    }
  }

  return 'MATCH';
}

/**
 * Computes a deterministic fingerprint for an alert to facilitate deduplication and throttling.
 */
export function generateAlertFingerprint(
  rule: DetectionRule,
  event: SecurityEvent,
  timeBucketMs: number = 900000 // 15 minutes default
): string {
  const timeMs = Date.parse(event.timestamp);
  const bucket = Math.floor((isNaN(timeMs) ? Date.now() : timeMs) / timeBucketMs);
  const primaryIoc = event.iocIds && event.iocIds.length > 0 ? event.iocIds[0] : '';

  const components = [
    rule.ruleId ?? rule.id,
    event.assetId ?? '',
    event.userId ?? '',
    event.eventType ?? '',
    primaryIoc,
    bucket,
  ];

  return `fp-${simpleHash(components.join('|'))}`;
}

/**
 * Builds a canonical Alert from a matching DetectionRule and SecurityEvent.
 * Retains exact ruleId and ruleVersion provenance.
 */
export function buildAlertFromMatch(
  rule: DetectionRule,
  event: SecurityEvent,
  fingerprint: string
): Alert {
  const now = new Date().toISOString();
  const eventTime = event.timestamp || now;
  const timeMs = Date.parse(eventTime) || Date.now();
  const alertId = `alt-${timeMs}-${simpleHash(`${rule.id}|${event.id}|${fingerprint}`).slice(0, 8)}`;

  return {
    id: alertId,
    ruleId: rule.ruleId ?? rule.id,
    ruleVersion: rule.version ?? 1,
    ruleName: rule.name,
    title: `${rule.name} on ${event.assetId ?? event.userId ?? event.source}`,
    description: `${rule.description} Generated by telemetry from ${event.source} [${event.eventType}]: ${event.message}`,
    severity: rule.severity,
    status: 'NEW',
    category: rule.category || event.category,
    createdAt: now,
    firstSeenAt: eventTime,
    lastSeenAt: eventTime,
    occurrenceCount: 1,
    sourceEventIds: [event.id],
    primaryEventId: event.id,
    assetId: event.assetId,
    userId: event.userId,
    iocIds: event.iocIds ? [...event.iocIds] : undefined,
    mitreTechniqueId: rule.mitreTechniqueId,
    mitreTactic: rule.mitreTactic,
    incidentId: event.incidentId,
    fingerprint,
    metadata: {
      detectionSource: 'LOCAL_DETECTION_ENGINE',
      ruleAuthor: rule.author,
      ruleAuthorId: rule.authorId,
      ruleVersion: rule.version ?? 1,
      ruleTags: rule.tags,
      triggerEventType: event.eventType,
    },
    // Compatibility aliases
    timestamp: now,
    source: event.source,
    sourceIp: event.srcIp,
    destIp: event.dstIp,
  };
}

/**
 * Deterministic local query engine for Alerts.
 */
export function queryAlerts(alerts: Alert[], query: AlertQuery = {}): Alert[] {
  let result = [...alerts];

  // 1. Status filter
  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    result = result.filter((a) => statuses.includes(a.status));
  }

  // 2. Severity filter
  if (query.severity) {
    const severities = Array.isArray(query.severity) ? query.severity : [query.severity];
    result = result.filter((a) => severities.includes(a.severity));
  }

  // 3. Category filter
  if (query.category) {
    const categories = Array.isArray(query.category) ? query.category : [query.category];
    result = result.filter((a) => categories.includes(a.category));
  }

  // 4. Rule ID filter
  if (query.ruleId) {
    result = result.filter((a) => a.ruleId === query.ruleId);
  }

  // 5. Asset filter
  if (query.assetId) {
    result = result.filter((a) => a.assetId === query.assetId);
  }

  // 6. User filter
  if (query.userId) {
    result = result.filter((a) => a.userId === query.userId);
  }

  // 7. Incident filter
  if (query.incidentId) {
    result = result.filter((a) => a.incidentId === query.incidentId);
  }

  // 8. Time bounds
  if (query.startTime) {
    const startMs = Date.parse(query.startTime);
    if (!isNaN(startMs)) {
      result = result.filter((a) => Date.parse(a.lastSeenAt) >= startMs);
    }
  }

  if (query.endTime) {
    const endMs = Date.parse(query.endTime);
    if (!isNaN(endMs)) {
      result = result.filter((a) => Date.parse(a.firstSeenAt) <= endMs);
    }
  }

  // 9. Full-text search
  if (query.search && query.search.trim() !== '') {
    const term = query.search.trim().toLowerCase();
    result = result.filter(
      (a) =>
        (a.title && a.title.toLowerCase().includes(term)) ||
        (a.description && a.description.toLowerCase().includes(term)) ||
        (a.ruleName && a.ruleName.toLowerCase().includes(term)) ||
        (a.assetId && a.assetId.toLowerCase().includes(term)) ||
        (a.userId && a.userId.toLowerCase().includes(term)) ||
        (a.mitreTechniqueId && a.mitreTechniqueId.toLowerCase().includes(term))
    );
  }

  // 10. Sorting (default: newest first)
  const sortOrder = query.sortOrder || 'DESC';
  result.sort((a, b) => {
    const timeA = Date.parse(a.lastSeenAt);
    const timeB = Date.parse(b.lastSeenAt);
    if (timeA !== timeB) {
      return sortOrder === 'DESC' ? timeB - timeA : timeA - timeB;
    }
    return a.id.localeCompare(b.id);
  });

  // 11. Pagination
  const offset = query.offset ?? 0;
  const limit = query.limit ?? result.length;
  return result.slice(offset, offset + limit);
}

/**
 * Computes derived statistical metrics for Alerts.
 */
export function computeAlertStats(alerts: Alert[]): AlertStats {
  const byStatus: Record<AlertStatus, number> = {
    NEW: 0,
    ACKNOWLEDGED: 0,
    RESOLVED: 0,
    SUPPRESSED: 0,
  };

  const byCategory: Record<any, number> = {};
  const ruleCounts = new Map<string, { ruleName: string; count: number }>();

  let openAlerts = 0;
  let criticalAlerts = 0;
  let highAlerts = 0;
  let mediumAlerts = 0;
  let lowAlerts = 0;
  let infoAlerts = 0;

  for (const a of alerts) {
    // Status
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    if (a.status === 'NEW' || a.status === 'ACKNOWLEDGED') {
      openAlerts++;
    }

    // Severity
    if (a.severity === 'CRITICAL') criticalAlerts++;
    else if (a.severity === 'HIGH') highAlerts++;
    else if (a.severity === 'MEDIUM') mediumAlerts++;
    else if (a.severity === 'LOW') lowAlerts++;
    else if (a.severity === 'INFO') infoAlerts++;

    // Category
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;

    // Rule
    const existing = ruleCounts.get(a.ruleId);
    if (existing) {
      existing.count++;
    } else {
      ruleCounts.set(a.ruleId, { ruleName: a.ruleName, count: 1 });
    }
  }

  const byRule = Array.from(ruleCounts.entries())
    .map(([ruleId, data]) => ({ ruleId, ruleName: data.ruleName, count: data.count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalAlerts: alerts.length,
    openAlerts,
    criticalAlerts,
    highAlerts,
    mediumAlerts,
    lowAlerts,
    infoAlerts,
    byStatus,
    byCategory,
    byRule,
  };
}

// ─── Step 9: Rule Simulation / Testing ───────────────────────────────────────

/**
 * Simulates a detection rule against a collection of SecurityEvents in a strictly
 * side-effect free, read-only manner. Zero alerts are persisted or emitted.
 */
export function simulateRule(
  rule: DetectionRule,
  events: SecurityEvent[],
  options: TestRunOptions = {}
): DetectionTestRunResult {
  const startTime = Date.now();
  let candidateEvents = [...events];

  // 1. Time range filtering
  if (options.startTime) {
    const startMs = Date.parse(options.startTime);
    if (!isNaN(startMs)) {
      candidateEvents = candidateEvents.filter(
        (e) => Date.parse(e.timestamp) >= startMs
      );
    }
  }

  if (options.endTime) {
    const endMs = Date.parse(options.endTime);
    if (!isNaN(endMs)) {
      candidateEvents = candidateEvents.filter(
        (e) => Date.parse(e.timestamp) <= endMs
      );
    }
  }

  // 2. Category filtering
  if (options.categoryFilter) {
    candidateEvents = candidateEvents.filter(
      (e) => e.category === options.categoryFilter
    );
  }

  // 3. Sample limit (default 300 to bound execution)
  const sampleLimit = options.sampleLimit ?? 300;
  const evaluatedEvents = candidateEvents.slice(0, sampleLimit);

  // 4. Force enable the rule for testing purpose
  const testRule: DetectionRule = {
    ...rule,
    enabled: true,
  };

  const matchedEventIds: string[] = [];
  const explanations: DetectionTestMatchExplanation[] = [];

  for (const event of evaluatedEvents) {
    const res = evaluateRule(testRule, event);
    const matched = res === 'MATCH';

    if (matched) {
      matchedEventIds.push(event.id);
    }

    // Build condition explanations
    const contributing: string[] = [];
    for (const cond of rule.conditions) {
      if (isConditionGroup(cond)) {
        const groupMatched = evaluateConditionGroup(cond, event);
        contributing.push(
          `Group (${cond.operator}) ${groupMatched ? 'MATCHED' : 'FAILED'}`
        );
      } else {
        const explanation = explainCondition(cond, event);
        contributing.push(explanation.text);
      }
    }

    const explanationSummary = matched
      ? `MATCHED [${rule.name}]: All conditions satisfied`
      : `NOT MATCHED [${rule.name}]: One or more conditions failed`;

    // Retain full explanation for first 50 events to avoid unbounded memory
    if (explanations.length < 50 || matched) {
      explanations.push({
        eventId: event.id,
        matched,
        explanation: explanationSummary,
        contributingConditions: contributing,
      });
    }
  }

  const executionTimeMs = Math.max(1, Date.now() - startTime);

  const testRun: DetectionTestRun = {
    id: `run-${Date.now()}-${simpleHash(`${rule.id}|${evaluatedEvents.length}`).slice(0, 6)}`,
    ruleId: rule.ruleId ?? rule.id,
    ruleVersion: rule.version ?? 1,
    executedBy: rule.authorId ?? 'ANALYST',
    executedAt: new Date().toISOString(),
    startTime: options.startTime,
    endTime: options.endTime,
    eventsEvaluated: evaluatedEvents.length,
    eventsMatched: matchedEventIds.length,
    executionTimeMs,
    status: 'COMPLETED',
    matchedEventIds,
    sampleExplanations: explanations.slice(0, 15),
  };

  return {
    testRun,
    explanations,
  };
}

// ─── Step 9: Rule Version Diffing ───────────────────────────────────────────

/**
 * Computes a structural field-by-field difference between two versions of a detection rule.
 */
export function diffRuleVersions(
  v1: DetectionRule,
  v2: DetectionRule
): RuleDiffResult {
  const changes: RuleDiffFieldChange[] = [];

  const compareField = (field: keyof DetectionRule, label?: string) => {
    const val1 = v1[field];
    const val2 = v2[field];
    const s1 = JSON.stringify(val1 ?? null);
    const s2 = JSON.stringify(val2 ?? null);
    if (s1 !== s2) {
      changes.push({
        field: label ?? String(field),
        oldValue: val1,
        newValue: val2,
      });
    }
  };

  compareField('name', 'Name');
  compareField('description', 'Description');
  compareField('severity', 'Severity');
  compareField('category', 'Category');
  compareField('eventTypes', 'Event Types');
  compareField('threshold', 'Threshold');
  compareField('timeWindowMs', 'Time Window');
  compareField('mitreTechniqueId', 'Primary MITRE Technique');
  compareField('mitreTechniqueIds', 'MITRE Techniques');
  compareField('tags', 'Tags');
  compareField('status', 'Lifecycle Status');
  compareField('enabled', 'Enabled State');

  // Deep condition comparison
  const condStr1 = JSON.stringify(v1.conditions ?? []);
  const condStr2 = JSON.stringify(v2.conditions ?? []);
  const conditionsChanged = condStr1 !== condStr2;

  if (conditionsChanged) {
    changes.push({
      field: 'conditions',
      oldValue: v1.conditions,
      newValue: v2.conditions,
    });
  }

  const summaryParts: string[] = [];
  if (conditionsChanged) summaryParts.push('Modified detection conditions');
  for (const ch of changes) {
    if (ch.field !== 'conditions') {
      summaryParts.push(`Changed ${ch.field} from "${String(ch.oldValue)}" to "${String(ch.newValue)}"`);
    }
  }

  return {
    ruleId: v2.ruleId ?? v2.id,
    fromVersion: v1.version ?? 1,
    toVersion: v2.version ?? 1,
    changes,
    conditionsChanged,
    summary: summaryParts.length > 0 ? summaryParts.join('; ') : 'No structural differences found',
  };
}

// ─── Step 9: Conversion Helpers ─────────────────────────────────────────────

/**
 * Creates a pre-populated Detection Rule draft input from an observed SecurityEvent.
 */
export function convertEventToDetectionDraft(
  event: SecurityEvent,
  author?: string
): CreateDetectionRuleInput {
  const conditions: RuleCondition[] = [
    { field: 'category', operator: 'EQUALS', value: event.category },
  ];

  if (event.eventType) {
    conditions.push({ field: 'eventType', operator: 'EQUALS', value: event.eventType });
  }

  if (event.processName) {
    conditions.push({ field: 'processName', operator: 'EQUALS', value: event.processName });
  } else if (event.commandLine) {
    conditions.push({ field: 'commandLine', operator: 'CONTAINS', value: event.commandLine.slice(0, 30) });
  } else if (event.domain) {
    conditions.push({ field: 'domain', operator: 'EQUALS', value: event.domain });
  } else if (event.dstIp) {
    conditions.push({ field: 'dstIp', operator: 'EQUALS', value: event.dstIp });
  } else if (event.severity) {
    conditions.push({ field: 'severity', operator: 'IN_LIST', value: [event.severity] });
  }

  const mitreId = typeof event.metadata?.mitreTechniqueId === 'string'
    ? event.metadata.mitreTechniqueId
    : undefined;

  const suggestedRuleId = `DET-CUSTOM-${Date.now().toString().slice(-4)}`;

  return {
    ruleId: suggestedRuleId,
    name: `Detection for ${event.eventType || 'Event'} on ${event.assetId ?? event.source}`,
    description: `Auto-generated draft detection rule derived from observed security event ${event.id}: "${event.message}".`,
    severity: event.severity === 'CRITICAL' ? 'CRITICAL' : event.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
    category: event.category,
    eventTypes: event.eventType ? [event.eventType] : undefined,
    conditions,
    threshold: 1,
    timeWindowMs: 900000,
    mitreTechniqueId: mitreId,
    tags: ['custom', 'event_derived', (event.category || '').toLowerCase()].filter(Boolean),
    changeDescription: `Initial draft generated from observed event ${event.id}`,
  };
}

/**
 * Converts compatible filter conditions from a ThreatHuntQuery into a DetectionRule draft.
 */
export function convertHuntQueryToDetectionDraft(
  query: ThreatHuntQuery,
  author?: string
): CreateDetectionRuleInput {
  const conditions: RuleCondition[] = [];

  const operatorMap: Record<string, any> = {
    equals: 'EQUALS',
    notEquals: 'NOT_EQUALS',
    contains: 'CONTAINS',
    startsWith: 'STARTS_WITH',
    endsWith: 'ENDS_WITH',
    greaterThan: 'GREATER_THAN',
    lessThan: 'LESS_THAN',
    greaterThanOrEqual: 'GREATER_THAN_OR_EQUAL',
    lessThanOrEqual: 'LESS_THAN_OR_EQUAL',
    in: 'IN_LIST',
    notIn: 'NOT_IN_LIST',
  };

  for (const f of query.conditions ?? []) {
    const mappedOp = operatorMap[f.operator] || (f.operator as string).toUpperCase();
    conditions.push({
      field: String(f.field),
      operator: mappedOp,
      value: f.value,
    });
  }

  const category = query.categories?.[0] ?? 'SECURITY_CONTROL';
  const suggestedRuleId = `DET-HUNT-${Date.now().toString().slice(-4)}`;
  const textSummary = query.text ? query.text.slice(0, 40) : 'Custom Hunt Conversion';

  return {
    ruleId: suggestedRuleId,
    name: `Detection Rule: ${textSummary}`,
    description: `Production detection rule converted from proactive threat hunt query: "${query.text || 'Custom Query'}".`,
    severity: query.severities?.[0] ? (query.severities[0] as any) : 'HIGH',
    category,
    conditions: conditions.length > 0 ? conditions : [{ field: 'category', operator: 'EQUALS', value: category }],
    threshold: 1,
    timeWindowMs: 900000,
    mitreTechniqueId: query.mitreTechniqueIds?.[0],
    tags: ['hunt_conversion', 'proactive'],
    changeDescription: `Converted from Threat Hunt query "${textSummary}"`,
  };
}

/**
 * Clones an existing DetectionRule as a new editable draft.
 */
export function cloneRuleAsDraft(
  rule: DetectionRule,
  author?: string
): CreateDetectionRuleInput {
  return {
    ruleId: `${rule.ruleId ?? rule.id}-CLONE`,
    name: `${rule.name} (Clone)`,
    description: `Clone of ${rule.name}: ${rule.description}`,
    severity: rule.severity,
    category: rule.category,
    eventTypes: rule.eventTypes ? [...rule.eventTypes] : undefined,
    conditions: JSON.parse(JSON.stringify(rule.conditions)),
    threshold: rule.threshold ?? 1,
    timeWindowMs: rule.timeWindowMs ?? 900000,
    mitreTechniqueId: rule.mitreTechniqueId,
    mitreTechniqueIds: rule.mitreTechniqueIds ? [...rule.mitreTechniqueIds] : undefined,
    mitreTactic: rule.mitreTactic,
    tags: rule.tags ? [...rule.tags, 'clone'] : ['clone'],
    changeDescription: `Cloned from ${rule.ruleId ?? rule.id} v${rule.version ?? 1}`,
  };
}
