/**
 * simulation-seed-prng.ts
 *
 * Deterministic pseudo-random number generator for reproducible cyber range simulations.
 * Uses the Mulberry32 algorithm.
 * Strictly zero Math.random() usage in simulation pipeline.
 */

export class DeterministicPrng {
  private state: number;

  constructor(seed: number = 1337) {
    // Ensure 32-bit positive integer state
    this.state = seed >>> 0;
  }

  /**
   * Generates a deterministic pseudo-random float in [0, 1).
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generates a deterministic integer in range [min, max] inclusive.
   */
  nextInt(min: number, max: number): number {
    const f = this.next();
    return Math.floor(f * (max - min + 1)) + min;
  }

  /**
   * Selects a random element deterministically from an array.
   */
  pick<T>(items: T[]): T {
    if (items.length === 0) throw new Error('Cannot pick from empty array');
    const index = this.nextInt(0, items.length - 1);
    return items[index];
  }

  /**
   * Generates a deterministic hex string of specified length.
   */
  nextHex(length: number): string {
    let result = '';
    const hexChars = '0123456789abcdef';
    for (let i = 0; i < length; i++) {
      const idx = this.nextInt(0, 15);
      result += hexChars[idx];
    }
    return result;
  }
}
