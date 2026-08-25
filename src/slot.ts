export type Slot = {
  readonly limit: number;
  tryAcquire(issueId: string): boolean;
  release(issueId: string): void;
  enqueue(issueId: string): void;
  dequeue(): string | null;
  remove(issueId: string): void;
  holder(): string | null;
  holders(): string[];
  queued(): string[];
  queuePosition(issueId: string): number;
};

export function createSlot(limit = 5): Slot {
  const holders = new Set<string>();
  const queue: string[] = [];
  return {
    limit,
    tryAcquire(issueId) {
      if (holders.has(issueId)) return false;
      if (holders.size >= limit) return false;
      holders.add(issueId);
      return true;
    },
    release(issueId) {
      holders.delete(issueId);
    },
    enqueue(issueId) {
      if (holders.has(issueId) || queue.includes(issueId)) return;
      queue.push(issueId);
    },
    dequeue() {
      return queue.shift() ?? null;
    },
    remove(issueId) {
      const i = queue.indexOf(issueId);
      if (i >= 0) queue.splice(i, 1);
    },
    holder() {
      return holders.values().next().value ?? null;
    },
    holders() {
      return [...holders];
    },
    queued() {
      return [...queue];
    },
    queuePosition(issueId) {
      return queue.indexOf(issueId) + 1;
    },
  };
}
