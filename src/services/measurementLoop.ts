export type MeasurementCycleOutcome = 'completed' | 'skipped' | 'failed';

export interface MeasurementLoopOptions {
  runCycle: (cycleNumber: number) => Promise<void | 'skipped'> | void | 'skipped';
  onCycleError?: (error: unknown, cycleNumber: number) => void;
  onCycleSettled?: (outcome: MeasurementCycleOutcome, cycleNumber: number) => void;
  intervalMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** A single-flight recurring loop. Each cycle schedules the next only after settling. */
export class SequentialMeasurementLoop {
  private readonly options: MeasurementLoopOptions;
  private active = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cycleNumber = 0;
  private inFlight: Promise<void> | null = null;

  constructor(options: MeasurementLoopOptions) {
    this.options = options;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.schedule(0);
  }

  stop(): void {
    this.active = false;
    if (this.timer !== null) {
      (this.options.cancel ?? clearTimeout)(this.timer);
      this.timer = null;
    }
  }

  get isActive(): boolean { return this.active; }
  get isRunning(): boolean { return this.running; }
  get cycleCount(): number { return this.cycleNumber; }

  whenIdle(): Promise<void> { return this.inFlight ?? Promise.resolve(); }

  private schedule(delayMs: number): void {
    if (!this.active || this.running || this.timer !== null) return;
    const schedule = this.options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.timer = schedule(() => {
      this.timer = null;
      void this.runOneCycle();
    }, delayMs);
  }

  private async runOneCycle(): Promise<void> {
    if (!this.active || this.running) return;
    this.running = true;
    const cycleNumber = ++this.cycleNumber;
    let outcome: MeasurementCycleOutcome = 'completed';
    const work = Promise.resolve().then(async () => {
      try {
        if (await this.options.runCycle(cycleNumber) === 'skipped') outcome = 'skipped';
      } catch (error) {
        outcome = 'failed';
        try { this.options.onCycleError?.(error, cycleNumber); } catch { /* diagnostics cannot stop the loop */ }
      } finally {
        this.running = false;
        try { this.options.onCycleSettled?.(outcome, cycleNumber); } catch { /* diagnostics cannot stop the loop */ }
        this.inFlight = null;
        this.schedule(this.options.intervalMs ?? 1000);
      }
    });
    this.inFlight = work;
    await work;
  }
}
