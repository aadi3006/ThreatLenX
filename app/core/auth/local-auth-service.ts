import type { UserCredentials, UserSession, RoleId } from '../models/auth';
import { ROLE_DEFINITIONS } from './rbac';

// ─── Static demo accounts for offline use ────────────────────────────────────
// Passwords are ignored in local mode — any value is accepted.
// Role override in credentials takes precedence over the account default.

interface LocalAccount {
  username: string;
  displayName: string;
  defaultRole: RoleId;
  tenantId: string;
}

const LOCAL_ACCOUNTS: LocalAccount[] = [
  { username: 'analyst1',       displayName: 'Alex Romero',    defaultRole: 'L1_ANALYST',         tenantId: 'DEMO' },
  { username: 'analyst2',       displayName: 'Sam Okafor',     defaultRole: 'L2_ANALYST',         tenantId: 'DEMO' },
  { username: 'responder',      displayName: 'Jo Blackwood',   defaultRole: 'INCIDENT_RESPONDER', tenantId: 'DEMO' },
  { username: 'hunter',         displayName: 'Morgan Vance',   defaultRole: 'THREAT_HUNTER',      tenantId: 'DEMO' },
  { username: 'manager',        displayName: 'Taylor Singh',   defaultRole: 'SOC_MANAGER',        tenantId: 'DEMO' },
  { username: 'admin',          displayName: 'Admin System',   defaultRole: 'PLATFORM_ADMIN',     tenantId: 'DEMO' },
  { username: 'alex_chen',      displayName: 'Alex Chen',      defaultRole: 'L1_ANALYST',         tenantId: 'DEMO' },
  { username: 'sarah_nakamura', displayName: 'Sarah Nakamura', defaultRole: 'L2_ANALYST',         tenantId: 'DEMO' },
  { username: 'elena_rostova',  displayName: 'Elena Rostova',  defaultRole: 'INCIDENT_RESPONDER', tenantId: 'DEMO' },
  { username: 'marcus_vance',   displayName: 'Marcus Vance',   defaultRole: 'SOC_MANAGER',        tenantId: 'DEMO' },
];

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

// In-memory session store (survives React re-renders via module scope)
let _currentSession: UserSession | null = null;

function generateToken(): string {
  return `LOCAL_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function authenticate(credentials: UserCredentials): UserSession {
  const account = LOCAL_ACCOUNTS.find(
    (a) => a.username.toLowerCase() === credentials.username.toLowerCase()
  );

  if (!account) {
    throw new Error(`Local auth: unknown username "${credentials.username}"`);
  }

  const role: RoleId = credentials.roleOverride ?? account.defaultRole;
  const now = Date.now();

  const session: UserSession = {
    token: generateToken(),
    userId: `local_${account.username}`,
    username: account.username,
    displayName: account.displayName,
    role,
    tenantId: account.tenantId,
    authenticatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_DURATION_MS).toISOString(),
  };

  _currentSession = session;

  // Persist to sessionStorage so it survives Next.js hot reloads
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('es_spatial_session', JSON.stringify(session));
  }

  return session;
}

export function getCurrentSession(): UserSession | null {
  if (_currentSession) return _currentSession;

  // Restore from sessionStorage after a page reload
  if (typeof window !== 'undefined') {
    const raw = sessionStorage.getItem('es_spatial_session');
    if (raw) {
      try {
        const session = JSON.parse(raw) as UserSession;
        // Validate it hasn't expired
        if (new Date(session.expiresAt).getTime() > Date.now()) {
          _currentSession = session;
          return _currentSession;
        }
      } catch {
        // malformed — clear it
        sessionStorage.removeItem('es_spatial_session');
      }
    }
  }

  return null;
}

export function logout(): void {
  _currentSession = null;
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('es_spatial_session');
  }
}

export function getLocalRoles() {
  return ROLE_DEFINITIONS;
}
