/**
 * Cooperative stop for the background loops (graceful shutdown of the worker process).
 *
 * requestStop() flips one process-wide flag. Every loop checks it before starting its next
 * pass and wakes from its poll sleep immediately, and the LinkedIn lease handed to the account
 * workers reports "not held" once stopping, so no new account unit, campaign step, import page
 * or profile read starts. Work already in flight finishes on its own; waitForLoops() lets the
 * shutdown wait for that up to a grace period.
 *
 * State lives on globalThis so every bundle in the process shares it. Dependency-free.
 */

interface LifecycleState {
  stopping: boolean;
  wakers: Set<() => void>;
  loops: Set<Promise<unknown>>;
}

const g = globalThis as typeof globalThis & { __linkiLifecycle?: LifecycleState };
const state = (g.__linkiLifecycle ??= { stopping: false, wakers: new Set(), loops: new Set() });

export function isStopping(): boolean {
  return state.stopping;
}

/** Stop starting new work. Idempotent. */
export function requestStop(): void {
  if (state.stopping) return;
  state.stopping = true;
  for (const wake of Array.from(state.wakers)) wake();
  state.wakers.clear();
}

/** Sleep `ms`, or less if a stop is requested meanwhile. */
export function stoppableSleep(ms: number): Promise<void> {
  if (state.stopping) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); state.wakers.delete(done); resolve(); };
    const timer = setTimeout(done, ms);
    state.wakers.add(done);
  });
}

/** Register a long-running loop so the shutdown can wait for it to end. */
export function trackLoop<T>(loop: Promise<T>): Promise<T> {
  state.loops.add(loop);
  const forget = () => { state.loops.delete(loop); };
  loop.then(forget, forget);
  return loop;
}

export function runningLoopCount(): number {
  return state.loops.size;
}

/** Wait until `done()` is true, polling, for at most `timeoutMs`. Resolves to whether it became true. */
export async function waitUntil(done: () => boolean, timeoutMs: number, pollMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
  return true;
}

/** Wait for every tracked loop to end, at most `timeoutMs`. True when all ended. */
export function waitForLoops(timeoutMs: number): Promise<boolean> {
  return waitUntil(() => state.loops.size === 0, timeoutMs);
}

/** Test hook: back to the running state with no tracked loops. */
export function _resetLifecycleForTests(): void {
  state.stopping = false;
  state.wakers.clear();
  state.loops.clear();
}
