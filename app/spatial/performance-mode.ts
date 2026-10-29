/**
 * performance-mode.ts
 *
 * Adaptive performance governor for EXPLAIN-SEC SPATIAL.
 * Supports:
 *   - FULL (default): Rich glassmorphism, blur filters, full particle/glow effects.
 *   - REDUCED: Disables heavy backdrop-filter blur and large radial glow overlays.
 *   - LOW: Strips all blur filters and continuous box-shadow animations for high FPS on constrained devices.
 */

'use client';

export type PerformanceMode = 'FULL' | 'REDUCED' | 'LOW';

class PerformanceManager {
  private mode: PerformanceMode = 'FULL';
  private listeners: Set<(mode: PerformanceMode) => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('explainsec_perf_mode') as PerformanceMode | null;
      if (saved && (saved === 'FULL' || saved === 'REDUCED' || saved === 'LOW')) {
        this.mode = saved;
        this.applyDomMode(saved);
      } else {
        this.applyDomMode('FULL');
      }
    }
  }

  public initClient(): void {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('explainsec_perf_mode') as PerformanceMode | null;
      if (saved && (saved === 'FULL' || saved === 'REDUCED' || saved === 'LOW')) {
        this.mode = saved;
      }
      this.applyDomMode(this.mode);
    }
  }

  public getMode(): PerformanceMode {
    return this.mode;
  }

  public setMode(mode: PerformanceMode, persist = true): void {
    this.mode = mode;
    this.applyDomMode(mode);
    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem('explainsec_perf_mode', mode);
      } catch {
        // storage quota / private mode guard
      }
    }
    this.listeners.forEach((fn) => fn(mode));
  }

  private applyDomMode(mode: PerformanceMode): void {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-perf-mode', mode);
    }
  }

  public subscribe(fn: (mode: PerformanceMode) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const performanceManager = new PerformanceManager();
