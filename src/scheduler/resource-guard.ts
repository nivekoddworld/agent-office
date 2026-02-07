import { Mutex, Semaphore } from "async-mutex";

/** Named mutex — one holder at a time. */
export class MutexGuard {
  private locks = new Map<string, { mutex: Mutex; holder?: string }>();

  async acquire(resource: string, holder: string): Promise<() => void> {
    let entry = this.locks.get(resource);
    if (!entry) {
      entry = { mutex: new Mutex() };
      this.locks.set(resource, entry);
    }
    const release = await entry.mutex.acquire();
    entry.holder = holder;
    return () => {
      entry!.holder = undefined;
      release();
    };
  }

  getHolder(resource: string): string | undefined {
    return this.locks.get(resource)?.holder;
  }

  listLocked(): Array<{ resource: string; holder: string }> {
    const result: Array<{ resource: string; holder: string }> = [];
    for (const [resource, entry] of this.locks) {
      if (entry.holder) result.push({ resource, holder: entry.holder });
    }
    return result;
  }
}

/** Named semaphore — N concurrent holders. */
export class SemaphoreGuard {
  private sems = new Map<string, { sem: Semaphore; max: number; used: number }>();

  create(resource: string, maxConcurrency: number): void {
    if (!this.sems.has(resource)) {
      this.sems.set(resource, {
        sem: new Semaphore(maxConcurrency),
        max: maxConcurrency,
        used: 0,
      });
    }
  }

  async acquire(resource: string): Promise<() => void> {
    const entry = this.sems.get(resource);
    if (!entry) throw new Error(`Semaphore "${resource}" not created`);
    const [, release] = await entry.sem.acquire();
    entry.used++;
    return () => {
      entry.used--;
      release();
    };
  }

  status(): Array<{ resource: string; used: number; max: number }> {
    return [...this.sems.entries()].map(([resource, e]) => ({
      resource,
      used: e.used,
      max: e.max,
    }));
  }
}
