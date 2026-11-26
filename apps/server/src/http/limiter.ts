/**
 * Sliding-window counter per key, in memory. For limits keyed by user rather than by IP, which
 * @fastify/rate-limit cannot do before the session is resolved. Per process: several instances would
 * each allow the limit.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and returns true, or returns false when the key is over its limit. */
  take(key: string): boolean {
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter((at) => t - at < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(t)
    this.hits.set(key, recent)
    if (this.hits.size > 10_000) this.prune(t)
    return true
  }

  private prune(t: number): void {
    for (const [key, list] of this.hits) {
      if (list.every((at) => t - at >= this.windowMs)) this.hits.delete(key)
    }
  }
}
