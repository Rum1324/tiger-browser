import type { FastifyBaseLogger } from 'fastify'

/**
 * Tracks work that outlives the request that started it (indexing, AI answers), so shutdown and tests
 * can wait for it instead of racing it.
 */
export class BackgroundTasks {
  private readonly pending = new Set<Promise<void>>()

  constructor(private readonly log: FastifyBaseLogger) {}

  run(name: string, task: () => Promise<void>): void {
    const p = (async () => {
      try {
        await task()
      } catch (err) {
        this.log.error({ err, task: name }, 'background task failed')
      }
    })()
    this.pending.add(p)
    void p.finally(() => this.pending.delete(p))
  }

  /** Resolves once every task, including tasks started while waiting, has settled. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending])
    }
  }

  get size(): number {
    return this.pending.size
  }
}
