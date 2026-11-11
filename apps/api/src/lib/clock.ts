export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };
export class FixedClock implements Clock {
  constructor(private t: Date) {}
  now() { return new Date(this.t); }
  set(t: Date) { this.t = t; }
  advanceMs(ms: number) { this.t = new Date(this.t.getTime() + ms); }
}
