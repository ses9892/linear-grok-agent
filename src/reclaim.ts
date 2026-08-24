import type { LinearPort } from "./ports.ts";
import type { Store } from "./store.ts";

export async function reclaimZombies(
  store: Store,
  linear: LinearPort,
  alive: (pid: number) => boolean,
): Promise<void> {
  for (const rec of store.listRunning()) {
    if (rec.pid === null || !alive(rec.pid)) {
      store.upsert({
        ...rec,
        status: "error",
        pid: null,
        updatedAt: Date.now(),
      });
      await linear.error(rec.linearAgentSessionId, "맥이 잠겨 중단됨. @Grok으로 재개");
    }
  }
}
