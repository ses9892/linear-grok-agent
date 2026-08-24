export type Slot = {
  tryAcquire(issueId: string): boolean;
  release(issueId: string): void;
  enqueue(issueId: string): void;
  dequeue(): string | null;
  holder(): string | null;
};

export function createSlot(): Slot {
  let holder: string | null = null;
  const queue: string[] = [];
  return {
    tryAcquire(issueId) {
      if (holder !== null) return false;
      holder = issueId;
      return true;
    },
    release(issueId) {
      if (holder === issueId) holder = null;
    },
    enqueue(issueId) {
      if (issueId === holder || queue.includes(issueId)) return;
      queue.push(issueId);
    },
    dequeue() {
      return queue.shift() ?? null;
    },
    holder() {
      return holder;
    },
  };
}
