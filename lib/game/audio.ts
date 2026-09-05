/** One short, quiet pickup chime; audio is initialized only by a game gesture. */
export class PickupAudio {
  private context: AudioContext | null = null;
  enabled = false;
  unlock() {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => {});
    } catch {
      /* Audio is optional. */
    }
  }
  play() {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      990,
      ctx.currentTime + 0.12,
    );
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.21);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  dispose() {
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
