/**
 * ThreatHuntingWorkspace.tsx
 *
 * EXPLAIN-SEC SPATIAL — Stage 5 Spatial Threat Hunting Operating Environment.
 *
 * Architectural Principles:
 * - Single source of truth: queries canonical SecurityEvents via SecurityService.
 * - Result provenance: clearly distinguishes KNOWN vs UNKNOWN events.
 * - Match explainability: "MATCHED BECAUSE: ...".
 * - Controlled workflow: Link to existing incident or create new incident from evidence.
 * - Graceful degradation across performance tiers (FULL, REDUCED, LOW).
 * - Zero external network calls.
 */

'use client';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { PerformanceMode } from '../performance-mode';
import type { Incident } from '../../core/models/incident';
import type {
  ThreatHunt,
  ThreatHuntQuery,
  ThreatHuntResult,
  ThreatHuntExecutionResult,
  ThreatHuntTemplate,
} from '../../core/models/hunting';
import type { EventCategory, EventSeverity } from '../../core/models/event';
import { securityService } from '../../core/security-service';
import { cyberAudio } from '../../cyber-audio';
import { spatialTransform } from '../../spatial-transform';
import { convertHuntQueryToDetectionDraft } from '../../core/security/detection-engine';
import { ThreatIntelProfile } from '../intel/ThreatIntelProfile';
import {
  Search,
  Sliders,
  Play,
  Bookmark,
  Sparkles,
  Shield,
  ExternalLink,
  HelpCircle,
  Filter,
  X,
  Terminal,
  Globe,
  Briefcase,
  Lock,
  Zap,
  ArrowLeft,
  Crosshair,
  RefreshCw,
  Brain,
} from 'lucide-react';
import ContextualAiAssistant from '../ai/ContextualAiAssistant';
import './threat-hunting.css';

export type PivotEntityType = 'IP' | 'HOST' | 'USER' | 'PROCESS' | 'IOC';

export interface PivotEntity {
  type: PivotEntityType;
  value: string;
  label?: string;
  sourceEventId?: string;
}

export type PivotCategory = 'HOSTS' | 'USERS' | 'PROCESSES' | 'EVENTS' | 'INCIDENTS' | 'INTEL';

export interface RelatedItem {
  id: string;
  category: PivotCategory;
  title: string;
  subtitle: string;
  severity?: string;
  rawPayload?: any;
  targetPivot?: PivotEntity;
}

export interface EntityRelationships {
  entity: PivotEntity;
  hosts: RelatedItem[];
  users: RelatedItem[];
  processes: RelatedItem[];
  events: RelatedItem[];
  incidents: RelatedItem[];
  threatIntel?: {
    indicatorId: string;
    type: string;
    classification?: string;
    confidence?: string;
    observationsCount: number;
    relatedAlertIds: string[];
    relatedIncidentIds: string[];
  } | null;
}

interface ThreatHuntingWorkspaceProps {
  perfMode: PerformanceMode;
  onClose: () => void;
  onInvestigateIncident: (incidentId: string) => void;
}

type QueryExecutionState = 'IDLE' | 'QUERYING' | 'FILTERING' | 'AGGREGATING' | 'READY';

export default function ThreatHuntingWorkspace({
  perfMode,
  onClose,
  onInvestigateIncident,
}: ThreatHuntingWorkspaceProps) {
  // Query Criteria State
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>('hunt-tpl-001');
  const [leftTab, setLeftTab] = useState<'TEMPLATES' | 'FILTERS'>('TEMPLATES');
  const [textSearch, setTextSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<EventCategory | ''>('PROCESS');
  const [selectedSeverity, setSelectedSeverity] = useState<EventSeverity | ''>('');
  const [processFilter, setProcessFilter] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  // Execution & Results State
  const [execState, setExecState] = useState<QueryExecutionState>('IDLE');
  const [executionResult, setExecutionResult] = useState<ThreatHuntExecutionResult | null>(null);
  const [selectedResult, setSelectedResult] = useState<ThreatHuntResult | null>(null);
  const [isAiOpen, setIsAiOpen] = useState(false);

  // Operational Entity Pivot State
  const [activePivotEntity, setActivePivotEntity] = useState<PivotEntity | null>(null);
  const [pivotRelationships, setPivotRelationships] = useState<EntityRelationships | null>(null);
  const [loadingRelationships, setLoadingRelationships] = useState(false);
  const [activePivotCategory, setActivePivotCategory] = useState<PivotCategory>('HOSTS');
  const [focusedPivotItem, setFocusedPivotItem] = useState<RelatedItem | null>(null);
  const [threatIntelTargetId, setThreatIntelTargetId] = useState<string | null>(null);
  const [dwellingEntityValue, setDwellingEntityValue] = useState<string | null>(null);
  const [dwellingItemId, setDwellingItemId] = useState<string | null>(null);
  const dwellTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Saved Hunts & Templates State
  const [templates, setTemplates] = useState<ThreatHuntTemplate[]>([]);
  const [savedHunts, setSavedHunts] = useState<ThreatHunt[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [showSavedHuntsDrawer, setShowSavedHuntsDrawer] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newHuntName, setNewHuntName] = useState('');
  const [newHuntNotes, setNewHuntNotes] = useState('');

  // Incident Linking / Creation Modals
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [targetIncidentId, setTargetIncidentId] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newIncidentTitle, setNewIncidentTitle] = useState('');
  const [newIncidentSummary, setNewIncidentSummary] = useState('');
  const [newIncidentSeverity, setNewIncidentSeverity] = useState<EventSeverity>('HIGH');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Active Aggregation Tab
  const [activeAggTab, setActiveAggTab] = useState<'asset' | 'user' | 'process' | 'ip' | 'category' | 'severity'>('asset');

  // Load initial templates, saved hunts, and incidents
  useEffect(() => {
    try {
      const tpls = securityService.getThreatHuntTemplates();
      setTemplates(tpls);

      securityService.getThreatHunts().then((hunts) => setSavedHunts(hunts));
      securityService.getIncidents().then((incs) => {
        setIncidents(incs);
        if (incs.length > 0) setTargetIncidentId(incs[0].id);
      });
    } catch {
      // Ignored in offline init
    }
  }, []);

  // Build query from active form inputs
  const currentQuery: ThreatHuntQuery = useMemo(() => {
    const q: ThreatHuntQuery = {
      limit: perfMode === 'LOW' ? 40 : perfMode === 'REDUCED' ? 70 : 100,
      sortOrder: 'DESC',
    };
    if (textSearch.trim()) q.text = textSearch.trim();
    if (selectedCategory) q.categories = [selectedCategory];
    if (selectedSeverity) q.severities = [selectedSeverity];
    if (processFilter.trim()) q.processes = [processFilter.trim()];
    if (ipFilter.trim()) {
      q.sourceIps = [ipFilter.trim()];
      q.destinationIps = [ipFilter.trim()];
    }
    if (startTime) q.startTime = startTime;
    if (endTime) q.endTime = endTime;
    return q;
  }, [textSearch, selectedCategory, selectedSeverity, processFilter, ipFilter, startTime, endTime, perfMode]);

  // Execute Hunt Query Pipeline
  const handleRunHunt = useCallback(async (overrideQuery?: ThreatHuntQuery) => {
    cyberAudio.playScan();
    setExecState('QUERYING');

    const queryToRun = overrideQuery ?? currentQuery;

    // Realistic non-blocking pipeline progression
    setTimeout(async () => {
      setExecState('FILTERING');
      setTimeout(async () => {
        setExecState('AGGREGATING');
        try {
          const result = await securityService.runThreatHunt(queryToRun);
          setExecutionResult(result);
          if (result.results.length > 0) {
            setSelectedResult(result.results[0]);
          } else {
            setSelectedResult(null);
          }
          setExecState('READY');
          cyberAudio.playSuccess();
        } catch (err) {
          console.error('Threat hunt failed:', err);
          setExecState('IDLE');
        }
      }, 100);
    }, 100);
  }, [currentQuery]);

  // Run baseline on mount
  useEffect(() => {
    handleRunHunt();
  }, [handleRunHunt]);

  // Apply a template
  const handleSelectTemplate = useCallback((tpl: ThreatHuntTemplate) => {
    cyberAudio.playSelect();
    setSelectedTemplateId(tpl.id);
    setSelectedCategory(tpl.query.categories?.[0] ?? '');
    setSelectedSeverity(tpl.query.severities?.[0] ?? '');
    setProcessFilter(tpl.query.processes?.[0] ?? '');
    setTextSearch(tpl.query.text ?? '');
    setStartTime(tpl.query.startTime ?? '');
    setEndTime(tpl.query.endTime ?? '');
    handleRunHunt(tpl.query);
  }, [handleRunHunt]);

  // Save current hunt
  const handleSaveHunt = useCallback(async () => {
    if (!newHuntName.trim()) return;
    try {
      const saved = await securityService.createThreatHunt({
        name: newHuntName.trim(),
        description: `Analyst hunt created from query: ${selectedCategory || 'ANY'} ${processFilter || textSearch || ''}`,
        query: currentQuery,
        notes: newHuntNotes.trim() || undefined,
        tags: [selectedCategory || 'HUNT', 'SAVED'],
      });
      setSavedHunts((prev) => [saved, ...prev]);
      setShowSaveModal(false);
      setNewHuntName('');
      setNewHuntNotes('');
      setStatusNotice(`Saved hunt "${saved.name}" successfully.`);
      cyberAudio.playSuccess();
    } catch (err) {
      console.error('Failed to save hunt:', err);
    }
  }, [newHuntName, newHuntNotes, currentQuery, selectedCategory, processFilter, textSearch]);

  // Link selected event to incident
  const handleLinkToIncident = useCallback(async () => {
    if (!selectedResult || !targetIncidentId) return;
    try {
      await securityService.linkHuntEventsToIncident(targetIncidentId, [selectedResult.eventId]);
      setShowLinkModal(false);
      setStatusNotice(`Attached event ${selectedResult.eventId} to incident ${targetIncidentId}.`);
      cyberAudio.playSuccess();
      // Refresh current results
      handleRunHunt();
    } catch (err) {
      console.error('Link to incident failed:', err);
    }
  }, [selectedResult, targetIncidentId, handleRunHunt]);

  // Create incident from evidence
  const handleCreateIncident = useCallback(async () => {
    if (!selectedResult || !newIncidentTitle.trim()) return;
    try {
      const newInc = await securityService.createIncidentFromHunt({
        title: newIncidentTitle.trim(),
        severity: newIncidentSeverity,
        summary: newIncidentSummary.trim() || `Discovered via Threat Hunt: ${selectedResult.explanation}`,
        eventIds: [selectedResult.eventId],
      });
      setShowCreateModal(false);
      setNewIncidentTitle('');
      setNewIncidentSummary('');
      setStatusNotice(`Created incident ${newInc.id} from hunt evidence!`);
      cyberAudio.playSuccess();
      handleRunHunt();
    } catch (err) {
      console.error('Create incident from hunt failed:', err);
    }
  }, [selectedResult, newIncidentTitle, newIncidentSeverity, newIncidentSummary, handleRunHunt]);

  // ─── CANONICAL ENTITY EXTRACTION FROM SELECTED EVENT ──────────────────────
  const extractedEntities: PivotEntity[] = useMemo(() => {
    if (!selectedResult) return [];
    const list: PivotEntity[] = [];
    const seen = new Set<string>();

    const add = (type: PivotEntityType, value?: string, label?: string) => {
      if (!value || !value.trim()) return;
      const v = value.trim();
      const key = `${type}:${v.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push({ type, value: v, label: label || v, sourceEventId: selectedResult.eventId });
      }
    };

    if (selectedResult.srcIp) add('IP', selectedResult.srcIp, `SRC: ${selectedResult.srcIp}`);
    if (selectedResult.dstIp && selectedResult.dstIp !== selectedResult.srcIp) {
      add('IP', selectedResult.dstIp, `DST: ${selectedResult.dstIp}`);
    }
    if (selectedResult.assetId) add('HOST', selectedResult.assetId, selectedResult.assetId);
    if (selectedResult.userId) add('USER', selectedResult.userId, selectedResult.userId);
    if (selectedResult.processName) add('PROCESS', selectedResult.processName, selectedResult.processName);
    if (selectedResult.event.fileHash) {
      add('IOC', selectedResult.event.fileHash, `HASH: ${selectedResult.event.fileHash.slice(0, 10)}...`);
    }
    if (selectedResult.event.iocIds && selectedResult.event.iocIds.length > 0) {
      selectedResult.event.iocIds.forEach((iocId) => add('IOC', iocId, iocId));
    }

    return list;
  }, [selectedResult]);

  // ─── CANONICAL ENTITY RELATIONSHIP RESOLUTION ──────────────────────────────
  useEffect(() => {
    if (!activePivotEntity) {
      setPivotRelationships(null);
      setFocusedPivotItem(null);
      return;
    }

    let isMounted = true;
    setLoadingRelationships(true);

    async function resolveRelationships() {
      try {
        const [assets, users, incidentsListRaw, allEvents, iocs, alerts] = await Promise.all([
          securityService.getAssets(),
          securityService.getUsers(),
          securityService.getIncidents(),
          securityService.getEvents(),
          securityService.getIOCs(),
          securityService.getAlerts(),
        ]);

        const entity = activePivotEntity!;
        const valLower = entity.value.toLowerCase().trim();

        const hosts: RelatedItem[] = [];
        const usersList: RelatedItem[] = [];
        const processes: RelatedItem[] = [];
        const events: RelatedItem[] = [];
        const incidentsList: RelatedItem[] = [];

        const seenHostIds = new Set<string>();
        const seenUserIds = new Set<string>();
        const seenProcesses = new Set<string>();
        const seenEventIds = new Set<string>();
        const seenIncIds = new Set<string>();

        // ─── FROM IP ───────────────────────────────────────────────
        if (entity.type === 'IP') {
          // 1. Related Hosts: matching IP or observed in events with that IP
          assets.forEach((a) => {
            if (
              a.ipAddress?.toLowerCase() === valLower ||
              a.name?.toLowerCase() === valLower ||
              a.id?.toLowerCase() === valLower
            ) {
              if (!seenHostIds.has(a.id)) {
                seenHostIds.add(a.id);
                hosts.push({
                  id: a.id,
                  category: 'HOSTS',
                  title: a.name || a.id,
                  subtitle: `${a.type || 'HOST'} • ${a.ipAddress || entity.value}`,
                  targetPivot: { type: 'HOST', value: a.id },
                });
              }
            }
          });

          allEvents.forEach((e) => {
            const matchIp =
              e.srcIp?.toLowerCase() === valLower ||
              e.dstIp?.toLowerCase() === valLower ||
              e.ip?.toLowerCase() === valLower;

            if (matchIp) {
              if (e.assetId && !seenHostIds.has(e.assetId)) {
                seenHostIds.add(e.assetId);
                const foundAsset = assets.find((a) => a.id === e.assetId);
                hosts.push({
                  id: e.assetId,
                  category: 'HOSTS',
                  title: foundAsset?.name || e.assetId,
                  subtitle: `Observed communicating with ${entity.value}`,
                  targetPivot: { type: 'HOST', value: e.assetId },
                });
              }

              if (e.userId && !seenUserIds.has(e.userId)) {
                seenUserIds.add(e.userId);
                const foundUser = users.find((u) => u.id === e.userId || u.username === e.userId);
                usersList.push({
                  id: e.userId,
                  category: 'USERS',
                  title: foundUser?.displayName || foundUser?.username || e.userId,
                  subtitle: `Active user during ${entity.value} session`,
                  targetPivot: { type: 'USER', value: e.userId },
                });
              }

              if (e.processName && !seenProcesses.has(e.processName.toLowerCase())) {
                seenProcesses.add(e.processName.toLowerCase());
                processes.push({
                  id: e.processName,
                  category: 'PROCESSES',
                  title: e.processName,
                  subtitle: `Process involved with ${entity.value}`,
                  targetPivot: { type: 'PROCESS', value: e.processName },
                });
              }

              if (!seenEventIds.has(e.id)) {
                seenEventIds.add(e.id);
                events.push({
                  id: e.id,
                  category: 'EVENTS',
                  title: e.eventType,
                  subtitle: `${e.category} • ${e.srcIp || '*'} → ${e.dstIp || '*'}`,
                  severity: e.severity,
                  rawPayload: e,
                });
              }
            }
          });

          // 2. Related Users from matched hosts
          users.forEach((u) => {
            const assignedMatch = u.assignedAssets?.some((aid) => seenHostIds.has(aid));
            if (assignedMatch && !seenUserIds.has(u.id)) {
              seenUserIds.add(u.id);
              usersList.push({
                id: u.id,
                category: 'USERS',
                title: u.displayName || u.username || u.id,
                subtitle: `${u.roleInOrg || 'USER'} • Assigned to related host`,
                targetPivot: { type: 'USER', value: u.id },
              });
            }
          });

          // 3. Related Incidents
          incidentsListRaw.forEach((inc) => {
            const hasHost = inc.affectedAssets?.some((aid) => seenHostIds.has(aid));
            const hasUser = inc.affectedUsers?.some((uid) => seenUserIds.has(uid));
            const hasIoc = inc.iocs?.some((iocVal) => iocVal.toLowerCase() === valLower);
            const hasTimeline = inc.timelineEvents?.some((t) => t.description?.toLowerCase().includes(valLower));

            if (hasHost || hasUser || hasIoc || hasTimeline) {
              if (!seenIncIds.has(inc.id)) {
                seenIncIds.add(inc.id);
                incidentsList.push({
                  id: inc.id,
                  category: 'INCIDENTS',
                  title: `[${inc.id}] ${inc.title}`,
                  subtitle: `Severity: ${inc.severity} • Status: ${inc.status}`,
                  severity: inc.severity,
                  targetPivot: { type: 'IP', value: entity.value },
                });
              }
            }
          });
        }
        // ─── FROM HOST ─────────────────────────────────────────────
        else if (entity.type === 'HOST') {
          const asset = assets.find((a) => a.id.toLowerCase() === valLower || a.name.toLowerCase() === valLower);
          if (asset?.ipAddress) {
            hosts.push({
              id: asset.id,
              category: 'HOSTS',
              title: asset.name,
              subtitle: `${asset.type} • IP: ${asset.ipAddress}`,
            });
          }

          allEvents.forEach((e) => {
            if (e.assetId?.toLowerCase() === valLower || (asset && e.assetId === asset.id)) {
              if (e.userId && !seenUserIds.has(e.userId)) {
                seenUserIds.add(e.userId);
                const foundUser = users.find((u) => u.id === e.userId || u.username === e.userId);
                usersList.push({
                  id: e.userId,
                  category: 'USERS',
                  title: foundUser?.displayName || foundUser?.username || e.userId,
                  subtitle: `Logged on ${entity.value}`,
                  targetPivot: { type: 'USER', value: e.userId },
                });
              }

              if (e.processName && !seenProcesses.has(e.processName.toLowerCase())) {
                seenProcesses.add(e.processName.toLowerCase());
                processes.push({
                  id: e.processName,
                  category: 'PROCESSES',
                  title: e.processName,
                  subtitle: `Executed on ${entity.value}`,
                  targetPivot: { type: 'PROCESS', value: e.processName },
                });
              }

              if (!seenEventIds.has(e.id)) {
                seenEventIds.add(e.id);
                events.push({
                  id: e.id,
                  category: 'EVENTS',
                  title: e.eventType,
                  subtitle: `${e.category} • ${e.processName || e.srcIp || ''}`,
                  severity: e.severity,
                  rawPayload: e,
                });
              }
            }
          });

          incidentsListRaw.forEach((inc) => {
            if (inc.affectedAssets?.some((aid) => aid.toLowerCase() === valLower || (asset && aid === asset.id))) {
              if (!seenIncIds.has(inc.id)) {
                seenIncIds.add(inc.id);
                incidentsList.push({
                  id: inc.id,
                  category: 'INCIDENTS',
                  title: `[${inc.id}] ${inc.title}`,
                  subtitle: `Severity: ${inc.severity} • Status: ${inc.status}`,
                  severity: inc.severity,
                });
              }
            }
          });
        }
        // ─── FROM USER ─────────────────────────────────────────────
        else if (entity.type === 'USER') {
          const user = users.find((u) => u.id.toLowerCase() === valLower || u.username.toLowerCase() === valLower);
          user?.assignedAssets?.forEach((aid) => {
            if (!seenHostIds.has(aid)) {
              seenHostIds.add(aid);
              const a = assets.find((x) => x.id === aid);
              hosts.push({
                id: aid,
                category: 'HOSTS',
                title: a?.name || aid,
                subtitle: `Assigned asset for ${entity.value}`,
                targetPivot: { type: 'HOST', value: aid },
              });
            }
          });

          allEvents.forEach((e) => {
            if (e.userId?.toLowerCase() === valLower || (user && e.userId === user.id)) {
              if (e.assetId && !seenHostIds.has(e.assetId)) {
                seenHostIds.add(e.assetId);
                const a = assets.find((x) => x.id === e.assetId);
                hosts.push({
                  id: e.assetId,
                  category: 'HOSTS',
                  title: a?.name || e.assetId,
                  subtitle: `Accessed by ${entity.value}`,
                  targetPivot: { type: 'HOST', value: e.assetId },
                });
              }

              if (e.processName && !seenProcesses.has(e.processName.toLowerCase())) {
                seenProcesses.add(e.processName.toLowerCase());
                processes.push({
                  id: e.processName,
                  category: 'PROCESSES',
                  title: e.processName,
                  subtitle: `Launched by ${entity.value}`,
                  targetPivot: { type: 'PROCESS', value: e.processName },
                });
              }

              if (!seenEventIds.has(e.id)) {
                seenEventIds.add(e.id);
                events.push({
                  id: e.id,
                  category: 'EVENTS',
                  title: e.eventType,
                  subtitle: `${e.category} on ${e.assetId || 'Host'}`,
                  severity: e.severity,
                  rawPayload: e,
                });
              }
            }
          });

          incidentsListRaw.forEach((inc) => {
            if (inc.affectedUsers?.some((uid) => uid.toLowerCase() === valLower || (user && uid === user.id))) {
              if (!seenIncIds.has(inc.id)) {
                seenIncIds.add(inc.id);
                incidentsList.push({
                  id: inc.id,
                  category: 'INCIDENTS',
                  title: `[${inc.id}] ${inc.title}`,
                  subtitle: `Severity: ${inc.severity} • Status: ${inc.status}`,
                  severity: inc.severity,
                });
              }
            }
          });
        }
        // ─── FROM PROCESS ──────────────────────────────────────────
        else if (entity.type === 'PROCESS') {
          allEvents.forEach((e) => {
            if (e.processName?.toLowerCase() === valLower) {
              if (e.assetId && !seenHostIds.has(e.assetId)) {
                seenHostIds.add(e.assetId);
                const a = assets.find((x) => x.id === e.assetId);
                hosts.push({
                  id: e.assetId,
                  category: 'HOSTS',
                  title: a?.name || e.assetId,
                  subtitle: `Host where ${entity.value} executed`,
                  targetPivot: { type: 'HOST', value: e.assetId },
                });
              }

              if (e.userId && !seenUserIds.has(e.userId)) {
                seenUserIds.add(e.userId);
                const u = users.find((x) => x.id === e.userId);
                usersList.push({
                  id: e.userId,
                  category: 'USERS',
                  title: u?.displayName || u?.username || e.userId,
                  subtitle: `Executed ${entity.value}`,
                  targetPivot: { type: 'USER', value: e.userId },
                });
              }

              if (!seenEventIds.has(e.id)) {
                seenEventIds.add(e.id);
                events.push({
                  id: e.id,
                  category: 'EVENTS',
                  title: e.eventType,
                  subtitle: `${e.category} • Host: ${e.assetId || '*'}`,
                  severity: e.severity,
                  rawPayload: e,
                });
              }
            }
          });

          incidentsListRaw.forEach((inc) => {
            const hasHost = inc.affectedAssets?.some((aid) => seenHostIds.has(aid));
            const hasEvent = inc.timelineEvents?.some((t) => t.description?.toLowerCase().includes(valLower));
            if (hasHost || hasEvent) {
              if (!seenIncIds.has(inc.id)) {
                seenIncIds.add(inc.id);
                incidentsList.push({
                  id: inc.id,
                  category: 'INCIDENTS',
                  title: `[${inc.id}] ${inc.title}`,
                  subtitle: `Severity: ${inc.severity} • Status: ${inc.status}`,
                  severity: inc.severity,
                });
              }
            }
          });
        }
        // ─── FROM IOC ──────────────────────────────────────────────
        else if (entity.type === 'IOC') {
          const ioc = iocs.find((i) => i.id.toLowerCase() === valLower || i.value.toLowerCase() === valLower);
          ioc?.relatedAssets?.forEach((aid) => {
            if (!seenHostIds.has(aid)) {
              seenHostIds.add(aid);
              const a = assets.find((x) => x.id === aid);
              hosts.push({
                id: aid,
                category: 'HOSTS',
                title: a?.name || aid,
                subtitle: `Host linked to IOC ${entity.value}`,
                targetPivot: { type: 'HOST', value: aid },
              });
            }
          });

          allEvents.forEach((e) => {
            const hasIoc =
              e.iocIds?.includes(entity.value) ||
              (ioc && e.iocIds?.includes(ioc.id)) ||
              e.srcIp?.toLowerCase() === valLower ||
              e.dstIp?.toLowerCase() === valLower ||
              e.fileHash?.toLowerCase() === valLower;

            if (hasIoc) {
              if (e.assetId && !seenHostIds.has(e.assetId)) {
                seenHostIds.add(e.assetId);
                const a = assets.find((x) => x.id === e.assetId);
                hosts.push({
                  id: e.assetId,
                  category: 'HOSTS',
                  title: a?.name || e.assetId,
                  subtitle: `Observed indicator telemetry`,
                  targetPivot: { type: 'HOST', value: e.assetId },
                });
              }

              if (e.userId && !seenUserIds.has(e.userId)) {
                seenUserIds.add(e.userId);
                const u = users.find((x) => x.id === e.userId);
                usersList.push({
                  id: e.userId,
                  category: 'USERS',
                  title: u?.displayName || u?.username || e.userId,
                  subtitle: `Associated with IOC ${entity.value}`,
                  targetPivot: { type: 'USER', value: e.userId },
                });
              }

              if (!seenEventIds.has(e.id)) {
                seenEventIds.add(e.id);
                events.push({
                  id: e.id,
                  category: 'EVENTS',
                  title: e.eventType,
                  subtitle: `Matched IOC telemetry: ${e.category}`,
                  severity: e.severity,
                  rawPayload: e,
                });
              }
            }
          });

          incidentsListRaw.forEach((inc) => {
            if (inc.iocs?.some((i) => i.toLowerCase() === valLower || (ioc && i === ioc.id))) {
              if (!seenIncIds.has(inc.id)) {
                seenIncIds.add(inc.id);
                incidentsList.push({
                  id: inc.id,
                  category: 'INCIDENTS',
                  title: `[${inc.id}] ${inc.title}`,
                  subtitle: `Severity: ${inc.severity} • Status: ${inc.status}`,
                  severity: inc.severity,
                });
              }
            }
          });
        }

        // Threat Intelligence resolution (Offline TI Architecture)
        let threatIntel = null;
        try {
          const tiRec = await securityService.getThreatIntel(entity.value);
          if (tiRec) {
            threatIntel = {
              indicatorId: tiRec.indicatorId || entity.value,
              type: tiRec.indicatorType || (entity.type === 'IP' ? 'IPV4' : 'HASH_SHA256'),
              classification: tiRec.classification,
              confidence: tiRec.confidence,
              observationsCount: tiRec.observationsCount || events.length,
              relatedAlertIds: alerts
                .filter(
                  (a) =>
                    a.description?.toLowerCase().includes(valLower) ||
                    a.title?.toLowerCase().includes(valLower)
                )
                .map((a) => a.id),
              relatedIncidentIds: incidentsList.map((i) => i.id),
            };
          }
        } catch {
          // Offline fallback
        }

        if (isMounted) {
          setPivotRelationships({
            entity,
            hosts,
            users: usersList,
            processes,
            events,
            incidents: incidentsList,
            threatIntel,
          });

          // Set default category to first non-empty category
          if (hosts.length > 0) setActivePivotCategory('HOSTS');
          else if (usersList.length > 0) setActivePivotCategory('USERS');
          else if (processes.length > 0) setActivePivotCategory('PROCESSES');
          else if (events.length > 0) setActivePivotCategory('EVENTS');
          else if (incidentsList.length > 0) setActivePivotCategory('INCIDENTS');
          else if (threatIntel) setActivePivotCategory('INTEL');
          else setActivePivotCategory('HOSTS');

          const defaultList =
            hosts.length > 0
              ? hosts
              : usersList.length > 0
              ? usersList
              : processes.length > 0
              ? processes
              : events;
          if (defaultList.length > 0) {
            setFocusedPivotItem(defaultList[0]);
          }
          setLoadingRelationships(false);
        }
      } catch (err) {
        console.error('Failed to resolve entity relationships:', err);
        if (isMounted) setLoadingRelationships(false);
      }
    }

    resolveRelationships();

    return () => {
      isMounted = false;
    };
  }, [activePivotEntity]);

  // ─── LOGICAL PIVOT EXECUTION ACTION ────────────────────────────────────────
  const executePivot = useCallback(
    (target: { type: 'HUNT' | 'INCIDENT' | 'INTEL' | 'DETECTION'; value?: string; item?: RelatedItem }) => {
      cyberAudio.playSelect();

      if (target.type === 'HUNT') {
        const pivotVal = target.value || activePivotEntity?.value || '';
        const entityType = activePivotEntity?.type;

        const updatedQuery: ThreatHuntQuery = {
          limit: perfMode === 'LOW' ? 40 : perfMode === 'REDUCED' ? 70 : 100,
          sortOrder: 'DESC',
        };

        if (entityType === 'IP') {
          setIpFilter(pivotVal);
          updatedQuery.sourceIps = [pivotVal];
          updatedQuery.destinationIps = [pivotVal];
        } else if (entityType === 'PROCESS') {
          setProcessFilter(pivotVal);
          updatedQuery.processes = [pivotVal];
        } else {
          setTextSearch(pivotVal);
          updatedQuery.text = pivotVal;
        }

        setStatusNotice(`Pivoted threat hunt query to ${entityType || 'ENTITY'}: ${pivotVal}`);
        handleRunHunt(updatedQuery);
      } else if (target.type === 'INCIDENT') {
        const incId = target.value || target.item?.id;
        if (incId) {
          onInvestigateIncident(incId);
        }
      } else if (target.type === 'INTEL') {
        const intelId = target.value || activePivotEntity?.value;
        if (intelId) {
          setThreatIntelTargetId(intelId);
        }
      } else if (target.type === 'DETECTION') {
        try {
          const draft = convertHuntQueryToDetectionDraft(currentQuery);
          securityService.createDetectionRuleDraft(draft);
          setStatusNotice('✓ Hunt query exported as Detection Rule draft');
          spatialTransform.setMode('DETECTION');
          cyberAudio.playSuccess();
        } catch (err: any) {
          setStatusNotice(`Export failed: ${err.message}`);
        }
      }
    },
    [activePivotEntity, perfMode, handleRunHunt, onInvestigateIncident, currentQuery]
  );

  // ─── POINT + DWELL HANDLERS (600ms dwell threshold) ───────────────────────
  const handleDwellEntityStart = useCallback((entity: PivotEntity) => {
    setDwellingEntityValue(entity.value);
    if (dwellTimeoutRef.current) clearTimeout(dwellTimeoutRef.current);
    dwellTimeoutRef.current = setTimeout(() => {
      cyberAudio.playSelect();
      setActivePivotEntity(entity);
      setDwellingEntityValue(null);
    }, 600);
  }, []);

  const handleDwellEntityEnd = useCallback(() => {
    setDwellingEntityValue(null);
    if (dwellTimeoutRef.current) clearTimeout(dwellTimeoutRef.current);
  }, []);

  const handleDwellItemStart = useCallback((item: RelatedItem) => {
    setDwellingItemId(item.id);
    if (dwellTimeoutRef.current) clearTimeout(dwellTimeoutRef.current);
    dwellTimeoutRef.current = setTimeout(() => {
      cyberAudio.playSelect();
      setFocusedPivotItem(item);
      setDwellingItemId(null);
    }, 600);
  }, []);

  const handleDwellItemEnd = useCallback(() => {
    setDwellingItemId(null);
    if (dwellTimeoutRef.current) clearTimeout(dwellTimeoutRef.current);
  }, []);

  // ─── GESTURES & KEYBOARD CONVERGENCE ──────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      // Hierarchical Escape navigation
      if (e.key === 'Escape') {
        // Level 1: Open Modals and Drawers
        if (showSaveModal || showLinkModal || showCreateModal || showSavedHuntsDrawer || threatIntelTargetId || isAiOpen) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (showSaveModal) setShowSaveModal(false);
          else if (showLinkModal) setShowLinkModal(false);
          else if (showCreateModal) setShowCreateModal(false);
          else if (showSavedHuntsDrawer) setShowSavedHuntsDrawer(false);
          else if (threatIntelTargetId) setThreatIntelTargetId(null);
          else if (isAiOpen) setIsAiOpen(false);
          cyberAudio.playClick();
          return;
        }

        // Level 2: Entity Pivot Drilldown
        if (activePivotEntity) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          setActivePivotEntity(null);
          setFocusedPivotItem(null);
          cyberAudio.playClick();
          return;
        }

        // Level 3: Result Focus / Selection
        if (selectedResult) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          setSelectedResult(null);
          cyberAudio.playClick();
          return;
        }

        // Level 4: Return to Spatial Command Hub
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        cyberAudio.playClick();
        onClose();
        return;
      }

      if (isInput) return;
      if (showSaveModal || showLinkModal || showCreateModal || showSavedHuntsDrawer || threatIntelTargetId || isAiOpen) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (activePivotEntity && pivotRelationships) {
          const cats: PivotCategory[] = ['HOSTS', 'USERS', 'PROCESSES', 'EVENTS', 'INCIDENTS', 'INTEL'];
          const validCats = cats.filter((c) => {
            if (c === 'HOSTS') return pivotRelationships.hosts.length > 0;
            if (c === 'USERS') return pivotRelationships.users.length > 0;
            if (c === 'PROCESSES') return pivotRelationships.processes.length > 0;
            if (c === 'EVENTS') return pivotRelationships.events.length > 0;
            if (c === 'INCIDENTS') return pivotRelationships.incidents.length > 0;
            if (c === 'INTEL') return !!pivotRelationships.threatIntel;
            return false;
          });
          if (validCats.length > 0) {
            const curIdx = validCats.indexOf(activePivotCategory);
            const nextIdx =
              e.key === 'ArrowRight'
                ? (curIdx + 1) % validCats.length
                : (curIdx - 1 + validCats.length) % validCats.length;
            setActivePivotCategory(validCats[nextIdx]);
            cyberAudio.playSelect();
          }
        } else if (extractedEntities.length > 0) {
          const curIdx = activePivotEntity
            ? extractedEntities.findIndex((x) => x.value === activePivotEntity.value)
            : -1;
          const nextIdx =
            e.key === 'ArrowRight'
              ? (curIdx + 1) % extractedEntities.length
              : (curIdx - 1 + extractedEntities.length) % extractedEntities.length;
          setActivePivotEntity(extractedEntities[nextIdx]);
          cyberAudio.playSelect();
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (activePivotEntity && pivotRelationships) {
          const list =
            activePivotCategory === 'HOSTS'
              ? pivotRelationships.hosts
              : activePivotCategory === 'USERS'
              ? pivotRelationships.users
              : activePivotCategory === 'PROCESSES'
              ? pivotRelationships.processes
              : activePivotCategory === 'EVENTS'
              ? pivotRelationships.events
              : pivotRelationships.incidents;

          if (list.length > 0) {
            const curIdx = focusedPivotItem ? list.findIndex((i) => i.id === focusedPivotItem.id) : -1;
            const nextIdx =
              e.key === 'ArrowDown'
                ? (curIdx + 1) % list.length
                : (curIdx - 1 + list.length) % list.length;
            setFocusedPivotItem(list[nextIdx]);
            cyberAudio.playSelect();
          }
        }
      } else if (e.key === 'Enter') {
        if (activePivotEntity) {
          if (focusedPivotItem?.category === 'INCIDENTS') {
            executePivot({ type: 'INCIDENT', item: focusedPivotItem });
          } else if (activePivotCategory === 'INTEL') {
            executePivot({ type: 'INTEL', value: activePivotEntity.value });
          } else {
            executePivot({ type: 'HUNT', value: focusedPivotItem?.title || activePivotEntity.value });
          }
        }
      }
    };

    const handleSpatialGesture = (e: CustomEvent<{ gesture: string }>) => {
      if (e.detail?.gesture === 'SWIPE_RIGHT') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      } else if (e.detail?.gesture === 'SWIPE_LEFT') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      } else if (e.detail?.gesture === 'FIST') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('spatial-gesture-navigate' as any, handleSpatialGesture as any);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('spatial-gesture-navigate' as any, handleSpatialGesture as any);
    };
  }, [
    activePivotEntity,
    pivotRelationships,
    activePivotCategory,
    focusedPivotItem,
    extractedEntities,
    selectedResult,
    showSaveModal,
    showLinkModal,
    showCreateModal,
    showSavedHuntsDrawer,
    threatIntelTargetId,
    isAiOpen,
    executePivot,
    onClose,
  ]);

  // Bounded constellation nodes with graceful degradation
  const renderedNodes = useMemo(() => {
    if (!executionResult) return [];
    const maxNodes = perfMode === 'LOW' ? 25 : perfMode === 'REDUCED' ? 50 : 80;
    const slice = executionResult.results.slice(0, maxNodes);

    return slice.map((res, idx) => {
      // Deterministic layout hash based on index and event properties
      const angle = (idx / Math.max(1, slice.length)) * 2 * Math.PI + (idx % 2 === 0 ? 0.25 : -0.25);
      const radiusX = 18 + ((idx % 4) + 1) * 7.5;
      const radiusY = 14 + ((idx % 4) + 1) * 6;
      const posX = 50 + Math.cos(angle) * radiusX;
      const posY = 50 + Math.sin(angle) * radiusY;

      const color =
        res.severity === 'CRITICAL'
          ? '#ff2a2a'
          : res.severity === 'HIGH'
          ? '#ff7700'
          : res.severity === 'MEDIUM'
          ? '#ffb700'
          : res.severity === 'LOW'
          ? '#00f0ff'
          : '#3dffb0';

      return {
        ...res,
        posX: Math.max(12, Math.min(88, Math.round(posX * 10) / 10)),
        posY: Math.max(14, Math.min(84, Math.round(posY * 10) / 10)),
        color,
        labelPlacement: idx % 2 === 0 ? 'label-bottom' : 'label-top',
      };
    });
  }, [executionResult, perfMode]);

  return (
    <section
      className={`threat-hunting-workspace tier-${perfMode.toLowerCase()}`}
      aria-label="Spatial Threat Hunting Operating Environment"
    >
      {/* ─── LEFT PANEL: Query Builder & Templates ─── */}
      <aside className="hunt-panel hunt-query-col">
        <header className="hunt-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Search size={14} color="#00f0ff" />
            <span>THREAT HUNT // QUERY</span>
          </div>
          <button
            className="hunt-btn-save"
            style={{ padding: '2px 6px', fontSize: 9 }}
            onClick={() => setShowSavedHuntsDrawer((prev) => !prev)}
            title="Toggle Saved Hunts Notebook"
          >
            <Bookmark size={11} />
            <span>SAVED ({savedHunts.length})</span>
          </button>
        </header>

        <div className="hunt-panel-content">
          {/* Sub-Tabs: Templates vs Custom Filters */}
          <div className="hunt-tab-switcher">
            <button
              className={`hunt-tab-btn ${leftTab === 'TEMPLATES' ? 'active' : ''}`}
              onClick={() => {
                cyberAudio.playClick();
                setLeftTab('TEMPLATES');
              }}
            >
              <Sparkles size={11} />
              <span>TEMPLATES ({templates.length})</span>
            </button>
            <button
              className={`hunt-tab-btn ${leftTab === 'FILTERS' ? 'active' : ''}`}
              onClick={() => {
                cyberAudio.playClick();
                setLeftTab('FILTERS');
              }}
            >
              <Filter size={11} />
              <span>FILTERS</span>
            </button>
          </div>

          {leftTab === 'TEMPLATES' ? (
            <div>
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className={`hunt-template-card ${selectedTemplateId === tpl.id ? 'active' : ''}`}
                  onClick={() => handleSelectTemplate(tpl)}
                >
                  <div className="tpl-header-row">
                    <div className="tpl-name" title={tpl.name}>{tpl.name}</div>
                    <span className="tpl-badge">{tpl.category}</span>
                  </div>
                  <div className="tpl-desc">{tpl.description}</div>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div className="hunt-field-group">
                <label className="hunt-field-label">SEARCH TEXT / IOC / PAYLOAD</label>
                <input
                  type="text"
                  className="hunt-input"
                  placeholder="e.g. powershell, 185.220, svchost..."
                  value={textSearch}
                  onChange={(e) => setTextSearch(e.target.value)}
                />
              </div>

              <div className="hunt-grid-2 hunt-field-group">
                <div>
                  <label className="hunt-field-label">CATEGORY</label>
                  <select
                    className="hunt-select"
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value as EventCategory | '')}
                  >
                    <option value="">ALL CATEGORIES</option>
                    <option value="PROCESS">PROCESS</option>
                    <option value="AUTHENTICATION">AUTHENTICATION</option>
                    <option value="NETWORK">NETWORK</option>
                    <option value="ENDPOINT">ENDPOINT</option>
                    <option value="FILE">FILE</option>
                    <option value="IDENTITY">IDENTITY</option>
                    <option value="SYSTEM">SYSTEM</option>
                    <option value="SECURITY_CONTROL">SECURITY_CONTROL</option>
                  </select>
                </div>

                <div>
                  <label className="hunt-field-label">SEVERITY</label>
                  <select
                    className="hunt-select"
                    value={selectedSeverity}
                    onChange={(e) => setSelectedSeverity(e.target.value as EventSeverity | '')}
                  >
                    <option value="">ALL SEVERITIES</option>
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                    <option value="INFO">INFO</option>
                  </select>
                </div>
              </div>

              <div className="hunt-grid-2 hunt-field-group">
                <div>
                  <label className="hunt-field-label">PROCESS NAME</label>
                  <input
                    type="text"
                    className="hunt-input"
                    placeholder="e.g. powershell.exe"
                    value={processFilter}
                    onChange={(e) => setProcessFilter(e.target.value)}
                  />
                </div>
                <div>
                  <label className="hunt-field-label">IP ADDRESS</label>
                  <input
                    type="text"
                    className="hunt-input"
                    placeholder="e.g. 10.40.12.27"
                    value={ipFilter}
                    onChange={(e) => setIpFilter(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action Bottom Bar */}
        <div className="hunt-actions-row">
          <button className="hunt-btn-run" onClick={() => handleRunHunt()}>
            <Play size={12} />
            <span>
              {execState === 'IDLE' || execState === 'READY'
                ? 'RUN HUNT'
                : `${execState}...`}
            </span>
          </button>

          <button className="hunt-btn-save" onClick={() => setShowSaveModal(true)}>
            <Bookmark size={12} />
            <span>SAVE</span>
          </button>
        </div>
      </aside>

      {/* ─── CENTER PANEL: Result Constellation Field ─── */}
      <main className="hunt-panel hunt-field-col" aria-label="Event Constellation Spatial Field">
        <header className="hunt-panel-header">
          <div className="hunt-header-title">
            <Globe size={13} color="#00f0ff" />
            <span>EVENT CONSTELLATION // {executionResult?.totalMatches ?? 0} MATCHES</span>
          </div>

          <div className="hunt-header-badges">
            <span className="hunt-count-tag tag-known">
              KNOWN: {executionResult?.aggregations.knownCount ?? 0}
            </span>
            <span className="hunt-count-tag tag-unknown">
              UNKNOWN: {executionResult?.aggregations.unknownCount ?? 0}
            </span>
            <button
              className="hunt-back-btn"
              onClick={onClose}
              title="Return to Spatial Command Hub (Esc)"
            >
              <ArrowLeft size={11} />
              <span>HUB</span>
            </button>
            <button
              className="hunt-close-btn"
              onClick={onClose}
              title="Return to SOC Spatial Canvas"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="hunt-field-canvas">
          <div className="hunt-field-grid" />

          {/* Tactical Constellation SVG Background & Inter-Node Paths */}
          <svg className="hunt-constellation-svg" aria-hidden="true">
            {/* Concentric distance radar rings */}
            <circle cx="50%" cy="50%" r="18%" fill="none" stroke="rgba(0, 240, 255, 0.08)" strokeDasharray="3 3" />
            <circle cx="50%" cy="50%" r="32%" fill="none" stroke="rgba(0, 240, 255, 0.05)" />
            <circle cx="50%" cy="50%" r="44%" fill="none" stroke="rgba(0, 240, 255, 0.03)" strokeDasharray="4 4" />
            {/* Subtle crosshair axes */}
            <line x1="50%" y1="8%" x2="50%" y2="92%" stroke="rgba(0, 240, 255, 0.05)" />
            <line x1="8%" y1="50%" x2="92%" y2="50%" stroke="rgba(0, 240, 255, 0.05)" />

            {/* Constellation inter-node connection links */}
            {renderedNodes.map((node, i) => {
              if (i === 0) return null;
              const prev = renderedNodes[i - 1];
              return (
                <line
                  key={`edge-${node.eventId}`}
                  x1={`${prev.posX}%`}
                  y1={`${prev.posY}%`}
                  x2={`${node.posX}%`}
                  y2={`${node.posY}%`}
                  stroke="rgba(0, 240, 255, 0.22)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
              );
            })}
          </svg>

          {/* Spatial Event Nodes with Lucide Glyphs */}
          {renderedNodes.map((node) => {
            const isSelected = selectedResult?.eventId === node.eventId;
            return (
              <div
                key={node.eventId}
                className={`hunt-node ${isSelected ? 'focused' : ''} ${node.isKnown ? 'known-halo' : 'unknown-halo'}`}
                style={{
                  left: `${node.posX}%`,
                  top: `${node.posY}%`,
                  borderColor: node.color,
                  boxShadow: isSelected
                    ? `0 0 20px ${node.color}, 0 0 35px ${node.color}55`
                    : `0 0 10px ${node.color}33`,
                }}
                onClick={() => {
                  cyberAudio.playSelect();
                  setSelectedResult(node);
                }}
                title={`${node.eventType} (${node.severity}) — Click to Inspect`}
              >
                <span className="node-icon">
                  {node.category === 'PROCESS' ? (
                    <Terminal size={13} color={node.color} />
                  ) : node.category === 'NETWORK' ? (
                    <Globe size={13} color={node.color} />
                  ) : node.category === 'AUTHENTICATION' ? (
                    <Lock size={13} color={node.color} />
                  ) : (
                    <Zap size={13} color={node.color} />
                  )}
                </span>
                <span className={`hunt-node-label ${node.labelPlacement}`} title={node.eventType}>
                  {node.eventType}
                </span>
              </div>
            );
          })}

          {renderedNodes.length === 0 && execState === 'READY' && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', color: '#64748b' }}>
              <HelpCircle size={28} style={{ margin: '0 auto 8px auto', display: 'block' }} />
              <div style={{ fontSize: 11, fontWeight: 700 }}>NO EVENTS MATCHED HUNT QUERY</div>
              <div style={{ fontSize: 9 }}>Adjust your query parameters or pick another BlackTide template.</div>
            </div>
          )}
        </div>
      </main>

      {/* ─── RIGHT PANEL: Hunt Inspector ─── */}
      <aside className="hunt-panel hunt-inspector-col">
        <header className="hunt-panel-header hunt-inspector-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Shield size={14} color="#00f0ff" />
            <span>HUNT INSPECTOR</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {selectedResult && (
              <span className={`provenance-pill ${selectedResult.isKnown ? 'known' : 'unknown'}`}>
                {selectedResult.isKnown ? 'KNOWN EVIDENCE' : 'UNKNOWN NOVEL'}
              </span>
            )}

            <button
              className="hunt-action-btn"
              style={{
                borderColor: isAiOpen ? '#00f0ff' : 'rgba(0, 240, 255, 0.4)',
                color: '#00f0ff',
                background: isAiOpen ? 'rgba(0, 240, 255, 0.2)' : 'rgba(0, 240, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                fontSize: '9px',
                borderRadius: '3px',
                border: '1px solid',
                cursor: 'pointer',
              }}
              onClick={() => {
                cyberAudio.playClick();
                setIsAiOpen((prev) => !prev);
              }}
              title="Toggle Contextual AI Hunt Result Summary"
            >
              <Brain size={11} />
              <span>AI SUMMARY</span>
            </button>
          </div>
        </header>

        <div className="hunt-panel-content">
          {selectedResult ? (
            <>
              {/* Status Notice if action occurred */}
              {statusNotice && (
                <div style={{ background: 'rgba(61, 255, 176, 0.15)', border: '1px solid #3dffb0', borderRadius: 4, padding: 6, fontSize: 10, color: '#3dffb0', marginBottom: 10 }}>
                  {statusNotice}
                </div>
              )}

              {/* ─── ENTITY PIVOT BAR: Extract & Dwell on Entities ─── */}
              {extractedEntities.length > 0 && (
                <div className="hunt-entity-bar">
                  <div className="hunt-entity-bar-title">
                    <span>◈ EXTRACTED ENTITIES // PIVOT MATRIX</span>
                    <span style={{ fontSize: 7.5, color: '#64748b' }}>POINT + DWELL / CLICK</span>
                  </div>
                  <div className="hunt-entity-chips-row">
                    {extractedEntities.map((ent) => {
                      const isSelected = activePivotEntity?.value === ent.value && activePivotEntity?.type === ent.type;
                      const isDwelling = dwellingEntityValue === ent.value;
                      return (
                        <button
                          key={`${ent.type}-${ent.value}`}
                          className={`hunt-entity-chip ${isSelected ? 'active' : ''} ${isDwelling ? 'dwell-active' : ''}`}
                          onClick={() => {
                            cyberAudio.playSelect();
                            setActivePivotEntity(isSelected ? null : ent);
                          }}
                          onMouseEnter={() => handleDwellEntityStart(ent)}
                          onMouseLeave={handleDwellEntityEnd}
                          title={`Select canonical entity ${ent.type}: ${ent.value}`}
                        >
                          <span className="hunt-chip-type-tag">{ent.type}</span>
                          <span>{ent.label || ent.value}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ─── PROGRESSIVE DISCLOSURE: RELATIONSHIPS vs EVENT DETAILS ─── */}
              {activePivotEntity ? (
                /* REVEAL RELATED ENTITIES STAGE */
                <div className="hunt-pivot-stage">
                  <div className="hunt-pivot-header">
                    <div className="hunt-pivot-target-badge">
                      <span className="hunt-chip-type-tag">{activePivotEntity.type}</span>
                      <span style={{ color: '#00f0ff' }}>{activePivotEntity.value}</span>
                    </div>
                    <button
                      className="hunt-pivot-back-btn"
                      onClick={() => {
                        cyberAudio.playClick();
                        setActivePivotEntity(null);
                        setFocusedPivotItem(null);
                      }}
                      title="Return to raw event inspector"
                    >
                      <ArrowLeft size={10} />
                      <span>BACK TO EVENT</span>
                    </button>
                  </div>

                  {/* Progressive Category Selector */}
                  <div className="hunt-pivot-categories">
                    {(['HOSTS', 'USERS', 'PROCESSES', 'EVENTS', 'INCIDENTS', 'INTEL'] as PivotCategory[]).map((cat) => {
                      const count =
                        cat === 'HOSTS'
                          ? pivotRelationships?.hosts.length ?? 0
                          : cat === 'USERS'
                          ? pivotRelationships?.users.length ?? 0
                          : cat === 'PROCESSES'
                          ? pivotRelationships?.processes.length ?? 0
                          : cat === 'EVENTS'
                          ? pivotRelationships?.events.length ?? 0
                          : cat === 'INCIDENTS'
                          ? pivotRelationships?.incidents.length ?? 0
                          : pivotRelationships?.threatIntel ? 1 : 0;

                      return (
                        <button
                          key={cat}
                          className={`hunt-pivot-cat-btn ${activePivotCategory === cat ? 'active' : ''}`}
                          onClick={() => {
                            cyberAudio.playClick();
                            setActivePivotCategory(cat);
                            if (pivotRelationships) {
                              const list =
                                cat === 'HOSTS'
                                  ? pivotRelationships.hosts
                                  : cat === 'USERS'
                                  ? pivotRelationships.users
                                  : cat === 'PROCESSES'
                                  ? pivotRelationships.processes
                                  : cat === 'EVENTS'
                                  ? pivotRelationships.events
                                  : pivotRelationships.incidents;
                              if (list.length > 0) setFocusedPivotItem(list[0]);
                            }
                          }}
                        >
                          <span>{cat}</span>
                          <span className="hunt-pivot-cat-count">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Active Category Items List */}
                  {loadingRelationships ? (
                    <div style={{ padding: '16px 0', textAlign: 'center', color: '#64748b', fontSize: 10 }}>
                      <RefreshCw size={14} className="spin" style={{ margin: '0 auto 6px auto', display: 'block' }} />
                      Correlating canonical relationships from SecurityService...
                    </div>
                  ) : activePivotCategory === 'INTEL' ? (
                    /* Offline Threat Intelligence Panel */
                    <div className="hunt-pivot-item-card focused">
                      <div className="hunt-pivot-item-title-row">
                        <span className="hunt-pivot-item-title">
                          ◈ OFFLINE THREAT INTEL // {pivotRelationships?.threatIntel?.indicatorId || activePivotEntity.value}
                        </span>
                        <span style={{ fontSize: 8, color: '#3dffb0', fontWeight: 800 }}>
                          {pivotRelationships?.threatIntel?.confidence || 'LOCAL ASSESSMENT'}
                        </span>
                      </div>
                      <div className="hunt-pivot-item-sub">
                        Classification: {pivotRelationships?.threatIntel?.classification || 'INVESTIGATIVE'}
                      </div>
                      <div style={{ fontSize: 8.5, color: '#cbd5e1', marginTop: 4 }}>
                        Observations: <strong>{pivotRelationships?.threatIntel?.observationsCount ?? 0} occurrences</strong> across telemetry
                      </div>
                      <div style={{ fontSize: 8.5, color: '#94a3b8', marginTop: 2 }}>
                        Linked Alerts: {pivotRelationships?.threatIntel?.relatedAlertIds.length ?? 0} • Linked Incidents: {pivotRelationships?.threatIntel?.relatedIncidentIds.length ?? 0}
                      </div>
                      <button
                        className="hunt-action-deck-btn warning"
                        style={{ marginTop: 8 }}
                        onClick={() => executePivot({ type: 'INTEL', value: activePivotEntity.value })}
                      >
                        <Shield size={11} />
                        <span>OPEN FULL THREAT INTEL PROFILE</span>
                      </button>
                    </div>
                  ) : (
                    /* Entity Relationship Items (Single Category at a time) */
                    <div className="hunt-pivot-items-list">
                      {(() => {
                        const items =
                          activePivotCategory === 'HOSTS'
                            ? pivotRelationships?.hosts ?? []
                            : activePivotCategory === 'USERS'
                            ? pivotRelationships?.users ?? []
                            : activePivotCategory === 'PROCESSES'
                            ? pivotRelationships?.processes ?? []
                            : activePivotCategory === 'EVENTS'
                            ? pivotRelationships?.events ?? []
                            : pivotRelationships?.incidents ?? [];

                        if (items.length === 0) {
                          return (
                            <div style={{ padding: 12, textAlign: 'center', color: '#64748b', fontSize: 9 }}>
                              No direct {activePivotCategory.toLowerCase()} correlated to {activePivotEntity.value}
                            </div>
                          );
                        }

                        return items.map((item) => {
                          const isFocused = focusedPivotItem?.id === item.id;
                          const isDwelling = dwellingItemId === item.id;
                          return (
                            <div
                              key={item.id}
                              className={`hunt-pivot-item-card ${isFocused ? 'focused' : ''} ${isDwelling ? 'dwell-active' : ''}`}
                              onClick={() => {
                                cyberAudio.playSelect();
                                setFocusedPivotItem(item);
                              }}
                              onMouseEnter={() => handleDwellItemStart(item)}
                              onMouseLeave={handleDwellItemEnd}
                            >
                              <div className="hunt-pivot-item-title-row">
                                <span className="hunt-pivot-item-title" title={item.title}>
                                  {item.title}
                                </span>
                                {item.severity && (
                                  <span
                                    style={{
                                      fontSize: 7.5,
                                      fontWeight: 800,
                                      color:
                                        item.severity === 'CRITICAL'
                                          ? '#ff2a2a'
                                          : item.severity === 'HIGH'
                                          ? '#ff7700'
                                          : '#ffb700',
                                    }}
                                  >
                                    {item.severity}
                                  </span>
                                )}
                              </div>
                              <div className="hunt-pivot-item-sub" title={item.subtitle}>
                                {item.subtitle}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}

                  {/* Focused Context Deck */}
                  {focusedPivotItem && (
                    <div className="hunt-focused-context-box">
                      <div className="hunt-focused-context-header">
                        <span>FOCUSED CONTEXT › {focusedPivotItem.category}</span>
                        {focusedPivotItem.severity && (
                          <span style={{ color: focusedPivotItem.severity === 'CRITICAL' ? '#ff2a2a' : '#ffb700' }}>
                            {focusedPivotItem.severity}
                          </span>
                        )}
                      </div>
                      <div className="hunt-focused-context-meta">
                        <strong>{focusedPivotItem.title}</strong>
                        <div style={{ fontSize: 8, color: '#94a3b8', marginTop: 2 }}>{focusedPivotItem.subtitle}</div>
                      </div>

                      {/* Focused Operational Actions */}
                      <div className="hunt-focused-action-grid">
                        <button
                          className="hunt-action-deck-btn primary"
                          onClick={() => executePivot({ type: 'HUNT', value: focusedPivotItem.title || activePivotEntity.value })}
                          title="Pivot threat hunt query to focus on this entity"
                        >
                          <Crosshair size={10} />
                          <span>PIVOT HUNT</span>
                        </button>

                        {(focusedPivotItem.category === 'INCIDENTS' || selectedResult?.relatedIncidentId) && (
                          <button
                            className="hunt-action-deck-btn success"
                            onClick={() => executePivot({ type: 'INCIDENT', item: focusedPivotItem })}
                            title="Open full Spatial Incident Investigation"
                          >
                            <ExternalLink size={10} />
                            <span>INVESTIGATE</span>
                          </button>
                        )}

                        <button
                          className="hunt-action-deck-btn warning"
                          onClick={() => executePivot({ type: 'INTEL', value: activePivotEntity.value })}
                          title="Open offline Threat Intelligence profile"
                        >
                          <Shield size={10} />
                          <span>THREAT INTEL</span>
                        </button>

                        <button
                          className="hunt-action-deck-btn warning"
                          onClick={() => executePivot({ type: 'DETECTION' })}
                          title="Convert current hunt query into a Detection Rule draft"
                        >
                          <Sliders size={10} />
                          <span>DETECTION</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* RAW EVENT INSPECTION (DEFAULT VIEW) */
                <>
                  {/* Explainability Box */}
                  <div className="explain-box">
                    <div className="explain-header">
                      <Sparkles size={11} />
                      <span>DETERMINISTIC MATCH RATIONALE</span>
                    </div>
                    <div>{selectedResult.explanation}</div>
                  </div>

                  {/* Canonical Event Metadata */}
                  <div className="inspector-fields-card">
                    <div className="inspector-field-row">
                      <span className="inspector-label">EVENT ID:</span>
                      <span className="inspector-val" title={selectedResult.eventId}>{selectedResult.eventId}</span>
                    </div>
                    <div className="inspector-field-row">
                      <span className="inspector-label">TIMESTAMP:</span>
                      <span className="inspector-val" title={selectedResult.timestamp}>{selectedResult.timestamp}</span>
                    </div>
                    <div className="inspector-field-row">
                      <span className="inspector-label">EVENT TYPE:</span>
                      <span className="inspector-val" title={selectedResult.eventType}>{selectedResult.eventType}</span>
                    </div>
                    <div className="inspector-field-row">
                      <span className="inspector-label">CATEGORY:</span>
                      <span className="inspector-val" title={selectedResult.category}>{selectedResult.category}</span>
                    </div>
                    <div className="inspector-field-row">
                      <span className="inspector-label">SEVERITY:</span>
                      <span className="inspector-val" style={{ color: selectedResult.severity === 'CRITICAL' ? '#ff2a2a' : '#ffb700', fontWeight: 800 }}>
                        {selectedResult.severity}
                      </span>
                    </div>
                    {selectedResult.assetId && (
                      <div className="inspector-field-row">
                        <span className="inspector-label">ASSET:</span>
                        <span className="inspector-val" title={selectedResult.assetId}>{selectedResult.assetId}</span>
                      </div>
                    )}
                    {selectedResult.userId && (
                      <div className="inspector-field-row">
                        <span className="inspector-label">USER:</span>
                        <span className="inspector-val" title={selectedResult.userId}>{selectedResult.userId}</span>
                      </div>
                    )}
                    {selectedResult.processName && (
                      <div className="inspector-field-row">
                        <span className="inspector-label">PROCESS:</span>
                        <span className="inspector-val" title={selectedResult.processName}>{selectedResult.processName}</span>
                      </div>
                    )}
                    {selectedResult.srcIp && (
                      <div className="inspector-field-row">
                        <span className="inspector-label">SRC / DST IP:</span>
                        <span className="inspector-val" title={`${selectedResult.srcIp} → ${selectedResult.dstIp ?? '*'}`}>
                          {selectedResult.srcIp} → {selectedResult.dstIp ?? '*'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Raw Message */}
                  <div className="inspector-telemetry-box">
                    <strong style={{ color: '#00f0ff', display: 'block', fontSize: 8.5, letterSpacing: '0.06em', marginBottom: 2 }}>TELEMETRY MESSAGE:</strong>
                    <div style={{ wordBreak: 'break-word', fontSize: 9.5 }}>{selectedResult.event.message}</div>
                  </div>

                  {/* Relationship Links */}
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 8.5, color: '#64748b', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 3 }}>CORRELATED ARTIFACTS:</div>
                    {selectedResult.relatedIncidentId && (
                      <div style={{ fontSize: 9.5, color: '#3dffb0', marginBottom: 2 }}>
                        Linked Incident: <strong>{selectedResult.relatedIncidentId}</strong>
                      </div>
                    )}
                    {selectedResult.relatedAlertIds.length > 0 && (
                      <div style={{ fontSize: 9.5, color: '#00f0ff' }}>
                        Linked Alerts: {selectedResult.relatedAlertIds.join(', ')}
                      </div>
                    )}
                    {!selectedResult.relatedIncidentId && selectedResult.relatedAlertIds.length === 0 && (
                      <div style={{ fontSize: 8.5, color: '#94a3b8' }}>None. This event has not been flagged by any alert or incident.</div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="inspector-actions">
                    <button
                      className="action-btn action-btn-investigate"
                      onClick={() => {
                        if (selectedResult.relatedIncidentId) {
                          onInvestigateIncident(selectedResult.relatedIncidentId);
                        }
                      }}
                      disabled={!selectedResult.relatedIncidentId}
                    >
                      <ExternalLink size={11} />
                      <span>INVESTIGATE IN SPATIAL</span>
                    </button>

                    <button
                      className="action-btn action-btn-case"
                      onClick={async () => {
                        try {
                          cyberAudio.playSelect();
                          const allCases = await securityService.getCases();
                          if (allCases.length > 0) {
                            await securityService.addCaseFinding(allCases[0].id, {
                              title: `Hunt Finding: ${selectedResult.eventType} on ${selectedResult.assetId ?? 'Host'}`,
                              description: selectedResult.explanation,
                              severity: selectedResult.severity,
                              relatedEventIds: [selectedResult.event.id],
                              relatedIncidentIds: selectedResult.relatedIncidentId ? [selectedResult.relatedIncidentId] : undefined,
                            });
                            setStatusNotice(`Evidence attached to ${allCases[0].caseNumber} as finding`);
                          } else {
                            setStatusNotice('No active cases available to attach finding');
                          }
                        } catch (err) {
                          setStatusNotice((err as Error).message);
                        }
                      }}
                    >
                      <Briefcase size={11} />
                      <span>ATTACH TO CASE</span>
                    </button>

                    <button
                      className="action-btn action-btn-detection"
                      onClick={async () => {
                        try {
                          cyberAudio.playSelect();
                          const draft = convertHuntQueryToDetectionDraft(currentQuery);
                          await securityService.createDetectionRuleDraft(draft);
                          setStatusNotice('✓ Hunt query exported as Detection Rule draft');
                          spatialTransform.setMode('DETECTION');
                        } catch (err: any) {
                          setStatusNotice(`Export failed: ${err.message}`);
                        }
                      }}
                      title="Convert current hunt query into a declarative Detection Rule draft"
                    >
                      <Sliders size={11} />
                      <span>CONVERT TO DETECTION RULE</span>
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', color: '#64748b', marginTop: 30 }}>
              <Shield size={24} style={{ margin: '0 auto 8px auto', display: 'block', color: 'rgba(0, 240, 255, 0.4)' }} />
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>SELECT AN EVENT NODE TO INSPECT</div>
            </div>
          )}
        </div>
      </aside>

      {/* ─── BOTTOM PANEL: Result Timeline & Aggregations ─── */}
      <footer className="hunt-panel hunt-timeline-col">
        {/* Metric Summary */}
        <div className="hunt-summary-card">
          <div className="hunt-stat-row">
            <span style={{ color: '#94a3b8' }}>EXECUTION TIME:</span>
            <strong style={{ color: '#3dffb0' }}>{executionResult?.executionTimeMs ?? 0} ms</strong>
          </div>
          <div className="hunt-stat-row">
            <span style={{ color: '#94a3b8' }}>TOTAL MATCHES:</span>
            <strong style={{ color: '#00f0ff' }}>{executionResult?.totalMatches ?? 0}</strong>
          </div>
          <div className="hunt-stat-row">
            <span style={{ color: '#94a3b8' }}>NOVEL DISCOVERIES:</span>
            <strong style={{ color: '#ffb700' }}>{executionResult?.aggregations.unknownCount ?? 0}</strong>
          </div>
        </div>

        {/* Aggregation Pills */}
        <div className="hunt-agg-area">
          <div className="agg-tabs-bar">
            <span
              className={`agg-tab-item ${activeAggTab === 'asset' ? 'active' : ''}`}
              onClick={() => setActiveAggTab('asset')}
            >
              BY ASSET ({executionResult?.aggregations.byAsset.length ?? 0})
            </span>
            <span
              className={`agg-tab-item ${activeAggTab === 'user' ? 'active' : ''}`}
              onClick={() => setActiveAggTab('user')}
            >
              BY USER ({executionResult?.aggregations.byUser.length ?? 0})
            </span>
            <span
              className={`agg-tab-item ${activeAggTab === 'process' ? 'active' : ''}`}
              onClick={() => setActiveAggTab('process')}
            >
              BY PROCESS ({executionResult?.aggregations.byProcess.length ?? 0})
            </span>
            <span
              className={`agg-tab-item ${activeAggTab === 'ip' ? 'active' : ''}`}
              onClick={() => setActiveAggTab('ip')}
            >
              BY IP ({executionResult?.aggregations.bySourceIp.length ?? 0})
            </span>
          </div>

          <div className="agg-pills-row">
            {activeAggTab === 'asset' &&
              executionResult?.aggregations.byAsset.map((a) => (
                <div
                  key={a.key}
                  className="agg-chip"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    cyberAudio.playSelect();
                    setActivePivotEntity({ type: 'HOST', value: a.key });
                  }}
                  title={`Pivot to Host ${a.key}`}
                >
                  <span>{a.key}</span>
                  <span className="agg-chip-val">{a.count}</span>
                </div>
              ))}
            {activeAggTab === 'user' &&
              executionResult?.aggregations.byUser.map((u) => (
                <div
                  key={u.key}
                  className="agg-chip"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    cyberAudio.playSelect();
                    setActivePivotEntity({ type: 'USER', value: u.key });
                  }}
                  title={`Pivot to User ${u.key}`}
                >
                  <span>{u.key}</span>
                  <span className="agg-chip-val">{u.count}</span>
                </div>
              ))}
            {activeAggTab === 'process' &&
              executionResult?.aggregations.byProcess.map((p) => (
                <div
                  key={p.key}
                  className="agg-chip"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    cyberAudio.playSelect();
                    setActivePivotEntity({ type: 'PROCESS', value: p.key });
                  }}
                  title={`Pivot to Process ${p.key}`}
                >
                  <span>{p.key}</span>
                  <span className="agg-chip-val">{p.count}</span>
                </div>
              ))}
            {activeAggTab === 'ip' &&
              executionResult?.aggregations.bySourceIp.map((ip) => (
                <div
                  key={ip.key}
                  className="agg-chip"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    cyberAudio.playSelect();
                    setActivePivotEntity({ type: 'IP', value: ip.key });
                  }}
                  title={`Pivot to IP ${ip.key}`}
                >
                  <span>{ip.key}</span>
                  <span className="agg-chip-val">{ip.count}</span>
                </div>
              ))}
          </div>
        </div>
      </footer>

      {/* ─── MODAL: Save Hunt ─── */}
      {showSaveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="hunt-panel" style={{ width: 420, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 13, color: '#3dffb0' }}>SAVE THREAT HUNT NOTEBOOK</h3>
            <label style={{ fontSize: 10, color: '#94a3b8' }}>HUNT NAME</label>
            <input
              type="text"
              className="hunt-input"
              style={{ marginBottom: 10 }}
              placeholder="e.g. Obfuscated PowerShell on Finance Endpoints"
              value={newHuntName}
              onChange={(e) => setNewHuntName(e.target.value)}
            />
            <label style={{ fontSize: 10, color: '#94a3b8' }}>ANALYST NOTES / HYPOTHESIS</label>
            <textarea
              className="hunt-input"
              rows={3}
              style={{ marginBottom: 14 }}
              placeholder="Record investigation context..."
              value={newHuntNotes}
              onChange={(e) => setNewHuntNotes(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="hunt-btn-save" onClick={() => setShowSaveModal(false)}>CANCEL</button>
              <button className="hunt-btn-run" onClick={handleSaveHunt}>CONFIRM SAVE</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Link to Incident ─── */}
      {showLinkModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="hunt-panel" style={{ width: 400, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 13, color: '#00f0ff' }}>LINK EVIDENCE TO EXISTING INCIDENT</h3>
            <label style={{ fontSize: 10, color: '#94a3b8' }}>SELECT TARGET INCIDENT</label>
            <select
              className="hunt-select"
              style={{ marginBottom: 14 }}
              value={targetIncidentId}
              onChange={(e) => setTargetIncidentId(e.target.value)}
            >
              {incidents.map((inc) => (
                <option key={inc.id} value={inc.id}>
                  [{inc.id}] {inc.title} ({inc.severity})
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="hunt-btn-save" onClick={() => setShowLinkModal(false)}>CANCEL</button>
              <button className="hunt-btn-run" onClick={handleLinkToIncident}>LINK EVIDENCE</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Create Incident from Evidence ─── */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="hunt-panel" style={{ width: 440, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 13, color: '#ff7700' }}>CREATE INCIDENT FROM HUNT EVIDENCE</h3>
            <label style={{ fontSize: 10, color: '#94a3b8' }}>INCIDENT TITLE</label>
            <input
              type="text"
              className="hunt-input"
              style={{ marginBottom: 10 }}
              value={newIncidentTitle}
              onChange={(e) => setNewIncidentTitle(e.target.value)}
            />
            <div className="hunt-grid-2" style={{ marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 10, color: '#94a3b8' }}>SEVERITY</label>
                <select
                  className="hunt-select"
                  value={newIncidentSeverity}
                  onChange={(e) => setNewIncidentSeverity(e.target.value as EventSeverity)}
                >
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </div>
            </div>
            <label style={{ fontSize: 10, color: '#94a3b8' }}>EXECUTIVE SUMMARY</label>
            <textarea
              className="hunt-input"
              rows={3}
              style={{ marginBottom: 14 }}
              value={newIncidentSummary}
              onChange={(e) => setNewIncidentSummary(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="hunt-btn-save" onClick={() => setShowCreateModal(false)}>CANCEL</button>
              <button className="hunt-btn-run" onClick={handleCreateIncident}>CREATE INCIDENT</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Threat Intelligence Profile ─── */}
      {threatIntelTargetId && (
        <ThreatIntelProfile
          indicatorId={threatIntelTargetId}
          onClose={() => setThreatIntelTargetId(null)}
          onPivot={(entityId, entityType) => {
            setThreatIntelTargetId(null);
            if (entityType === 'INCIDENT') {
              onInvestigateIncident(entityId);
            } else if (entityType === 'ASSET' || entityType === 'HOST') {
              setActivePivotEntity({ type: 'HOST', value: entityId });
            } else if (entityType === 'USER') {
              setActivePivotEntity({ type: 'USER', value: entityId });
            } else if (entityType === 'IOC' || entityType === 'IP') {
              setActivePivotEntity({ type: 'IP', value: entityId });
            }
          }}
        />
      )}

      {/* ── Contextual AI Hunt Result Summary Drawer ── */}
      <ContextualAiAssistant
        mode="HUNT_RESULT"
        targetId={selectedTemplateId || selectedResult?.eventId || 'HUNT-QUERY'}
        isOpen={isAiOpen}
        onClose={() => setIsAiOpen(false)}
      />

      {/* ─── MODAL: Saved Hunts Notebook Drawer ─── */}
      {showSavedHuntsDrawer && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShowSavedHuntsDrawer(false)}
        >
          <div
            className="hunt-panel"
            style={{
              width: 520,
              maxWidth: '92vw',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="hunt-panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Bookmark size={13} color="#3dffb0" />
                <span>SAVED THREAT HUNTS ({savedHunts.length})</span>
              </div>
              <button
                className="hunt-close-btn"
                onClick={() => setShowSavedHuntsDrawer(false)}
                title="Close Saved Hunts (Esc)"
              >
                <X size={14} />
              </button>
            </header>
            <div className="hunt-panel-content" style={{ padding: 12 }}>
              {savedHunts.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '30px 10px' }}>
                  <Bookmark size={28} style={{ margin: '0 auto 8px auto', display: 'block', color: 'rgba(61, 255, 176, 0.4)' }} />
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>NO SAVED HUNTS RECORDED</div>
                  <div style={{ fontSize: 9, marginTop: 4 }}>Run any threat hunt query and click SAVE to record an investigation notebook.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {savedHunts.map((hunt) => (
                    <div key={hunt.id} className="hunt-saved-item-card">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#e0f2fe' }}>{hunt.name}</span>
                        <span style={{ fontSize: 8, color: '#3dffb0', background: 'rgba(61, 255, 176, 0.12)', padding: '1px 5px', borderRadius: 2 }}>
                          {hunt.status || 'SAVED'}
                        </span>
                      </div>
                      {hunt.notes && (
                        <div style={{ fontSize: 8.5, color: '#94a3b8', marginBottom: 6, fontStyle: 'italic' }}>
                          "{hunt.notes}"
                        </div>
                      )}
                      <div style={{ fontSize: 8, color: '#64748b', display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                        <span>Created: {new Date(hunt.createdAt).toLocaleDateString()}</span>
                        {hunt.query.categories && <span>Category: {hunt.query.categories.join(', ')}</span>}
                        {hunt.query.severities && <span>Severity: {hunt.query.severities.join(', ')}</span>}
                        {hunt.query.processes && <span>Process: {hunt.query.processes.join(', ')}</span>}
                        {hunt.query.text && <span>Query: "{hunt.query.text}"</span>}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          className="hunt-btn-run"
                          style={{ padding: '3px 8px', fontSize: 9 }}
                          onClick={() => {
                            setSelectedTemplateId(null);
                            setSelectedCategory(hunt.query.categories?.[0] ?? '');
                            setSelectedSeverity(hunt.query.severities?.[0] ?? '');
                            setProcessFilter(hunt.query.processes?.[0] ?? '');
                            setIpFilter(hunt.query.sourceIps?.[0] ?? hunt.query.destinationIps?.[0] ?? '');
                            setTextSearch(hunt.query.text ?? '');
                            setStartTime(hunt.query.startTime ?? '');
                            setEndTime(hunt.query.endTime ?? '');
                            setShowSavedHuntsDrawer(false);
                            handleRunHunt(hunt.query);
                            setStatusNotice(`Loaded saved hunt "${hunt.name}"`);
                          }}
                        >
                          <Play size={10} />
                          <span>LOAD & RUN</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
