import { AsyncLocalStorage } from "async_hooks";

/**
 * Who a data-provider call is for: set around a signal run or an enrichment pass, read by
 * tregCall when it logs the call, so cost can be reported per agent, signal and item, and
 * the scheduler can weigh each item's cost against the leads it brings.
 */
export interface CostTag { agentId?: string | null; sourceId?: string | null; sourceType?: string | null; itemKey?: string | null; runId?: string | null }

const store = new AsyncLocalStorage<CostTag>();

export function withCostTag<T>(tag: CostTag, fn: () => Promise<T>): Promise<T> {
  return store.run({ ...(store.getStore() ?? {}), ...tag }, fn);
}

export const currentCostTag = (): CostTag => store.getStore() ?? {};
