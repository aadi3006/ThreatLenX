/**
 * RbacBanner.tsx
 *
 * Visibly communicates RBAC permissions across the EXPLAIN-SEC SPATIAL surface.
 * Demonstrates authoritative role matrix:
 *   - SOC Analyst: investigate, collect evidence, create findings
 *   - Responder: investigate, execute response, collect evidence
 *   - Manager: approve sensitive action, escalate, manage cases
 *   - Administrator: manage users/policies, full platform access
 *
 * Clearly indicates unauthorized actions with explicit reasons.
 */

'use client';

import React from 'react';
import type { UserSession, RoleId } from '../../core/models/auth';
import { getRoleCapabilitySummary } from '../../core/auth/rbac';
import { Shield, ShieldAlert, ShieldCheck, User, Lock, CheckCircle2 } from 'lucide-react';
import { cyberAudio } from '../../cyber-audio';

interface RbacBannerProps {
  session: UserSession | null;
  onRoleChange?: (username: string) => void;
  compact?: boolean;
}

export default function RbacBanner({
  session,
  onRoleChange,
  compact = false,
}: RbacBannerProps) {
  const role: RoleId = session?.role ?? 'L1_ANALYST';
  const summary = getRoleCapabilitySummary(role);

  const getRoleColor = (r: RoleId) => {
    switch (r) {
      case 'PLATFORM_ADMIN':
        return '#f43f5e';
      case 'SOC_MANAGER':
        return '#a78bfa';
      case 'INCIDENT_RESPONDER':
        return '#ffb700';
      case 'L2_ANALYST':
      case 'L1_ANALYST':
      default:
        return '#00f0ff';
    }
  };

  const roleColor = getRoleColor(role);

  return (
    <div
      className={`rbac-banner ${compact ? 'is-compact' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: compact ? '4px 10px' : '8px 14px',
        background: 'rgba(8, 14, 26, 0.9)',
        border: `1px solid ${roleColor}40`,
        borderRadius: 6,
        gap: 12,
        fontSize: 11,
        fontFamily: 'monospace',
      }}
      role="region"
      aria-label="Role-Based Access Control Context"
    >
      {/* Left: Persona & Role Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '2px 8px',
            borderRadius: 4,
            background: `${roleColor}15`,
            border: `1px solid ${roleColor}50`,
            color: roleColor,
            fontWeight: 700,
            letterSpacing: '0.05em',
          }}
        >
          <Shield size={12} />
          <span>{summary.roleTitle.toUpperCase()}</span>
        </div>

        <span style={{ color: '#94a3b8' }}>
          {session?.displayName ?? 'Alex Chen'}
        </span>
      </div>

      {/* Center: Visibly Communicated Permissions */}
      {!compact && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {/* Permitted Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#3dffb0', fontWeight: 700 }}>PERMISSIONS:</span>
            {summary.allowedActions.slice(0, 3).map((act, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 9,
                  color: '#3dffb0',
                  background: 'rgba(61, 255, 176, 0.1)',
                  padding: '1px 5px',
                  borderRadius: 3,
                }}
              >
                <CheckCircle2 size={9} />
                {act}
              </span>
            ))}
          </div>

          {/* Explicitly Restricted / Unauthorized with Clear Reasons */}
          {summary.restrictedActions.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: '#ff6b35', fontWeight: 700 }}>RESTRICTED:</span>
              {summary.restrictedActions.slice(0, 2).map((item, i) => (
                <span
                  key={i}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 9,
                    color: '#ffaa88',
                    background: 'rgba(255, 107, 53, 0.1)',
                    border: '1px solid rgba(255, 107, 53, 0.25)',
                    padding: '1px 5px',
                    borderRadius: 3,
                  }}
                  title={`Unauthorized: ${item.action}. Requires ${item.requiredRole} role.`}
                >
                  <Lock size={8} />
                  {item.action} (Requires {item.requiredRole})
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Right: Switcher for Testing / Pair Programming Verification */}
      {onRoleChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <User size={11} color="#64748b" />
          <span style={{ fontSize: 9, color: '#64748b' }}>PERSONA:</span>
          <select
            value={session?.username ?? 'alex_chen'}
            onChange={(e) => {
              cyberAudio.playClick();
              onRoleChange(e.target.value);
            }}
            aria-label="Switch RBAC Persona"
            style={{
              background: '#040810',
              color: '#e0f2fe',
              border: '1px solid rgba(0, 240, 255, 0.3)',
              borderRadius: 3,
              fontSize: 10,
              padding: '2px 6px',
              fontFamily: 'monospace',
              cursor: 'pointer',
            }}
          >
            <option value="alex_chen">Alex Chen [SOC Analyst]</option>
            <option value="sarah_nakamura">Sarah Nakamura [SOC Analyst L2]</option>
            <option value="elena_rostova">Elena Rostova [Responder]</option>
            <option value="marcus_vance">Marcus Vance [SOC Manager]</option>
            <option value="admin">Admin [Administrator]</option>
          </select>
        </div>
      )}
    </div>
  );
}
