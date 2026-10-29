/**
 * simulation-clock.ts
 *
 * Temporal Simulation Clock independent of wall-clock time.
 * Supports:
 * - Variable speeds: 0.5x, 1x, 2x, 4x
 * - Lifecycle: start, pause, resume, stepForward, reset
 * - Virtual scenario offset tracking (T+00:00 format)
 * - Tick listeners for UI and engine orchestration
 */

export type ClockSpeed = 0.5 | 1 | 2 | 4;

export type ClockState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED';

export type ClockTickListener = (virtualSeconds: number, formattedTime: string) => void;

export class SimulationClock {
  private _state: ClockState = 'IDLE';
  private _speed: ClockSpeed = 1;
  private _virtualSeconds: number = 0;
  private _maxDurationSeconds: number = 180;
  private _timerId: ReturnType<typeof setInterval> | null = null;
  private _listeners: Set<ClockTickListener> = new Set();
  private _tickIntervalMs: number = 250; // Engine ticks every 250ms

  constructor(maxDurationSeconds: number = 180, initialSpeed: ClockSpeed = 1) {
    this._maxDurationSeconds = maxDurationSeconds;
    this._speed = initialSpeed;
  }

  public get state(): ClockState {
    return this._state;
  }

  public get speed(): ClockSpeed {
    return this._speed;
  }

  public get virtualSeconds(): number {
    return this._virtualSeconds;
  }

  public get formattedTime(): string {
    return SimulationClock.formatVirtualTime(this._virtualSeconds);
  }

  public setSpeed(speed: ClockSpeed): void {
    this._speed = speed;
    if (this._state === 'RUNNING') {
      this.pause();
      this.resume();
    }
  }

  public addTickListener(listener: ClockTickListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  public start(): void {
    if (this._state === 'RUNNING') return;
    this._state = 'RUNNING';
    this._startTimer();
    this._notify();
  }

  public pause(): void {
    if (this._state !== 'RUNNING') return;
    this._state = 'PAUSED';
    this._stopTimer();
    this._notify();
  }

  public resume(): void {
    if (this._state !== 'PAUSED') return;
    this._state = 'RUNNING';
    this._startTimer();
    this._notify();
  }

  /**
   * Advances virtual clock by a specific number of seconds or to the next step.
   */
  public stepForward(seconds: number = 5): void {
    this._virtualSeconds = Math.min(this._virtualSeconds + seconds, this._maxDurationSeconds);
    if (this._virtualSeconds >= this._maxDurationSeconds) {
      this._state = 'COMPLETED';
      this._stopTimer();
    }
    this._notify();
  }

  public reset(): void {
    this._stopTimer();
    this._state = 'IDLE';
    this._virtualSeconds = 0;
    this._notify();
  }

  public seek(seconds: number): void {
    this._virtualSeconds = Math.max(0, Math.min(seconds, this._maxDurationSeconds));
    if (this._virtualSeconds >= this._maxDurationSeconds) {
      this._state = 'COMPLETED';
      this._stopTimer();
    }
    this._notify();
  }

  private _startTimer(): void {
    this._stopTimer();
    // In wall-clock terms, 1 virtual second passes every (1000 / speed) ms.
    // We tick every _tickIntervalMs, adding (_tickIntervalMs / 1000) * speed virtual seconds.
    this._timerId = setInterval(() => {
      const deltaVirtualSeconds = (this._tickIntervalMs / 1000) * this._speed;
      this._virtualSeconds = Math.min(this._virtualSeconds + deltaVirtualSeconds, this._maxDurationSeconds);

      if (this._virtualSeconds >= this._maxDurationSeconds) {
        this._state = 'COMPLETED';
        this._stopTimer();
      }

      this._notify();
    }, this._tickIntervalMs);
  }

  private _stopTimer(): void {
    if (this._timerId !== null) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
  }

  private _notify(): void {
    const formatted = this.formattedTime;
    for (const listener of this._listeners) {
      try {
        listener(this._virtualSeconds, formatted);
      } catch (err) {
        console.error('[SimulationClock] Listener error:', err);
      }
    }
  }

  /**
   * Formats seconds into standard scenario notation: "T+01:25"
   */
  public static formatVirtualTime(seconds: number): string {
    const totalSecs = Math.floor(seconds);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const mStr = mins.toString().padStart(2, '0');
    const sStr = secs.toString().padStart(2, '0');
    return `T+${mStr}:${sStr}`;
  }
}
