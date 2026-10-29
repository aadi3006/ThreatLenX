// Procedural Cyber Sci-Fi Audio Synthesizer using Web Audio API
// Generates tactical UI sounds with zero external audio assets
// STEP 11: MOTION LANGUAGE + PERFORMANCE HARDENING
// Sound is OPTIONAL, CONFIGURABLE, and STATE-DRIVEN.
// Sound is NEVER necessary for understanding the UI.

export interface CyberAudioConfig {
  enabled: boolean;
  volume: number; // 0.0 - 1.0
  muted: boolean;
  enableAlerts: boolean;
  enableFeedback: boolean;
  enableNavigation: boolean;
}

class CyberAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean = false;
  private volume: number = 0.25;
  private muted: boolean = false;
  private enableAlerts: boolean = true;
  private enableFeedback: boolean = true;
  private enableNavigation: boolean = true;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('explainsec_audio_config');
        if (saved) {
          const cfg = JSON.parse(saved);
          if (typeof cfg.enabled === 'boolean') this.enabled = cfg.enabled;
          if (typeof cfg.volume === 'number') this.volume = Math.max(0, Math.min(1, cfg.volume));
          if (typeof cfg.muted === 'boolean') this.muted = cfg.muted;
          if (typeof cfg.enableAlerts === 'boolean') this.enableAlerts = cfg.enableAlerts;
          if (typeof cfg.enableFeedback === 'boolean') this.enableFeedback = cfg.enableFeedback;
          if (typeof cfg.enableNavigation === 'boolean') this.enableNavigation = cfg.enableNavigation;
        }
      } catch {
        // Fallback to defaults
      }
    }
  }

  private init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private saveConfig(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        'explainsec_audio_config',
        JSON.stringify({
          enabled: this.enabled,
          volume: this.volume,
          muted: this.muted,
          enableAlerts: this.enableAlerts,
          enableFeedback: this.enableFeedback,
          enableNavigation: this.enableNavigation,
        })
      );
    } catch {}
  }

  public setEnabled(on: boolean): void {
    this.enabled = on;
    this.saveConfig();
    if (on) {
      this.init();
      this.playBeep(880, 0.04, 'sine', 0.08);
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
    }
    this.saveConfig();
  }

  public getVolume(): number {
    return this.volume;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.volume, this.ctx.currentTime);
    }
    this.saveConfig();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public configure(config: Partial<CyberAudioConfig>): void {
    if (typeof config.enabled === 'boolean') this.enabled = config.enabled;
    if (typeof config.volume === 'number') this.setVolume(config.volume);
    if (typeof config.muted === 'boolean') this.setMuted(config.muted);
    if (typeof config.enableAlerts === 'boolean') this.enableAlerts = config.enableAlerts;
    if (typeof config.enableFeedback === 'boolean') this.enableFeedback = config.enableFeedback;
    if (typeof config.enableNavigation === 'boolean') this.enableNavigation = config.enableNavigation;
    this.saveConfig();
  }

  public getConfig(): CyberAudioConfig {
    return {
      enabled: this.enabled,
      volume: this.volume,
      muted: this.muted,
      enableAlerts: this.enableAlerts,
      enableFeedback: this.enableFeedback,
      enableNavigation: this.enableNavigation,
    };
  }

  public playBeep(freq = 1200, duration = 0.03, type: OscillatorType = 'sine', gainVal = 0.05) {
    if (!this.enabled || this.muted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      const effectiveGain = gainVal * this.volume;
      gain.gain.setValueAtTime(effectiveGain, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // AudioContext failure recovery
    }
  }

  public playClick() {
    if (!this.enableNavigation) return;
    this.playBeep(2400, 0.018, 'triangle', 0.04);
  }

  public playSelect() {
    if (!this.enabled || this.muted || !this.enableFeedback) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(1600, now + 0.08);

      gain.gain.setValueAtTime(0.06 * this.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.09);
    } catch {}
  }

  public playModeSwitch() {
    if (!this.enabled || this.muted || !this.enableNavigation) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.14);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, now);
      filter.frequency.exponentialRampToValueAtTime(2400, now + 0.14);

      gain.gain.setValueAtTime(0.07 * this.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  public playScan() {
    if (!this.enabled || this.muted || !this.enableNavigation) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1800, now);
      osc.frequency.linearRampToValueAtTime(1200, now + 0.12);

      gain.gain.setValueAtTime(0.04 * this.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.12);
    } catch {}
  }

  public playSliderPitch(val: number) {
    if (!this.enabled || this.muted) return;
    const freq = 400 + (val / 100) * 1200;
    this.playBeep(freq, 0.015, 'sine', 0.025);
  }

  public playDwellTick(progress: number) {
    if (!this.enabled || this.muted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const freq = 700 + Math.min(1, Math.max(0, progress)) * 1100;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.02 * this.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.035);
    } catch {}
  }

  public playLockAcquired() {
    if (!this.enabled || this.muted || !this.enableFeedback) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1100, now);
      osc1.frequency.setValueAtTime(2200, now + 0.04);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1650, now);
      osc2.frequency.setValueAtTime(3300, now + 0.04);

      gain.gain.setValueAtTime(0.06 * this.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.masterGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.12);
      osc2.stop(now + 0.12);
    } catch {}
  }

  /**
   * SUCCESS state-driven audio signal:
   * Operation completes -> confirmation pulse -> stable state
   */
  public playSuccess() {
    if (!this.enabled || this.muted || !this.enableFeedback) return;
    this.playBeep(880, 0.04, 'sine', 0.06);
    setTimeout(() => this.playBeep(1760, 0.08, 'sine', 0.08), 50);
  }

  /**
   * FAILURE state-driven audio signal:
   * Operation fails -> controlled error acoustic
   */
  public playFailure(_reason?: string) {
    if (!this.enabled || this.muted || !this.enableFeedback) return;
    this.playBeep(330, 0.06, 'sawtooth', 0.06);
    setTimeout(() => this.playBeep(195, 0.11, 'sawtooth', 0.07), 60);
  }

  /**
   * ALERT state-driven audio signal:
   * Data-driven severity frequencies: CRITICAL, HIGH, MEDIUM, LOW
   */
  public playAlert(severity: string = 'MEDIUM') {
    if (!this.enabled || this.muted || !this.enableAlerts) return;
    const sev = severity.toUpperCase();
    if (sev === 'CRITICAL') {
      this.playBeep(220, 0.09, 'sawtooth', 0.08);
      setTimeout(() => this.playBeep(180, 0.13, 'sawtooth', 0.09), 80);
    } else if (sev === 'HIGH') {
      this.playBeep(330, 0.07, 'sawtooth', 0.07);
      setTimeout(() => this.playBeep(260, 0.10, 'sawtooth', 0.08), 70);
    } else if (sev === 'LOW' || sev === 'INFO') {
      this.playBeep(660, 0.04, 'sine', 0.04);
      setTimeout(() => this.playBeep(880, 0.05, 'sine', 0.04), 45);
    } else {
      // MEDIUM
      this.playBeep(440, 0.06, 'triangle', 0.06);
      setTimeout(() => this.playBeep(370, 0.08, 'triangle', 0.06), 60);
    }
  }

  public playHover() {
    if (!this.enabled || this.muted || !this.enableFeedback) return;
    this.playBeep(1400, 0.008, 'sine', 0.015);
  }
}

export const cyberAudio = new CyberAudioEngine();
