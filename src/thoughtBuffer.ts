export type ThoughtBuffer = {
  push(chunk: string): void;
  flush(): void;
};

export function createThoughtBuffer(opts: {
  emit: (text: string) => void;
  minChars?: number;
  maxChars?: number;
  idleMs?: number;
}): ThoughtBuffer {
  const minChars = opts.minChars ?? 160;
  const maxChars = opts.maxChars ?? 700;
  const idleMs = opts.idleMs ?? 1500;
  let buf = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flush(): void {
    clearTimer();
    const text = buf.replace(/\s+/g, " ").trim();
    buf = "";
    if (text.length > 0) {
      opts.emit(text);
    }
  }

  function schedule(): void {
    clearTimer();
    timer = setTimeout(flush, idleMs);
  }

  return {
    push(chunk) {
      if (!chunk) return;
      buf += chunk;
      if (buf.length >= maxChars) {
        flush();
        return;
      }
      if (buf.trim().length >= minChars && /[.!?。]\s*$/.test(buf)) {
        flush();
        return;
      }
      schedule();
    },
    flush,
  };
}
