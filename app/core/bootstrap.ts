/**
 * Provider bootstrap — wires the concrete provider into SecurityService.
 *
 * This is the ONLY file that imports a concrete provider.
 * resetLocalData() is also re-exported here so callers never need to import
 * from the storage layer directly.
 * To swap to a remote provider in the future, change this file only.
 *
 * Call `bootstrapSecurity()` once, before the React tree renders.
 * It is idempotent — safe to call multiple times (no-op after first call).
 */

import { securityService } from './security-service';
import { LocalProvider } from './providers/local-provider';
import { ConnectedSecurityProvider } from './providers/connected-provider';
import { resetLocalData as _resetLocalData } from './storage/idb-store';

let _bootstrapPromise: Promise<void> | null = null;

export async function bootstrapSecurity(): Promise<void> {
  if (_bootstrapPromise) return _bootstrapPromise;

  _bootstrapPromise = (async () => {
    const local = new LocalProvider();
    const provider = new ConnectedSecurityProvider(local);
    await securityService.bootstrap(provider);

    // Seed a default demo session so the UI is immediately usable in dev/demo mode
    if (!securityService.getSession()) {
      try {
        await securityService.login({ username: 'analyst2' });
      } catch {
        // Non-fatal — user can log in manually
      }
    }
  })();

  return _bootstrapPromise;
}

/**
 * Wipe all IndexedDB stores, clear the seeded flag, then re-bootstrap.
 * On the next initialize() call the provider will re-seed Operation BlackTide.
 * Use from dev tools or a "Reset Demo Data" UI control.
 */
export async function resetAndReinitialize(): Promise<void> {
  await _resetLocalData();
  _bootstrapPromise = null; // allow re-bootstrap
  await bootstrapSecurity();
}

/** Low-level store wipe without re-bootstrap (for advanced use). */
export { _resetLocalData as resetLocalData };

export { securityService };
export { aiService } from './ai/ai-provider';
