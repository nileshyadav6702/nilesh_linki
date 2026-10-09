import { useCallback, useEffect, useMemo, useState } from "react";
import type { LeadRowData } from "@/components/agents/leads/types";

/** Filters, paging and the fetched page for the Contacts table (every contact in the workspace). */

export interface ContactFilters {
  agent: string; list: string; band: string; email: string; phone: string; interested: boolean; replied: boolean;
  signal: string; approval: string; step: string; from: string; to: string; sort: string;
}

export const EMPTY_FILTERS: ContactFilters = {
  agent: "", list: "", band: "", email: "", phone: "", interested: false, replied: false, signal: "", approval: "", step: "", from: "", to: "", sort: "newest",
};

/** How many filters differ from the defaults (sort doesn't count). */
export function activeCount(f: ContactFilters): number {
  const fields = (Object.keys(EMPTY_FILTERS) as Array<keyof ContactFilters>).filter((k) => !["sort", "from", "to"].includes(k) && f[k] !== EMPTY_FILTERS[k]).length;
  return fields + (f.from || f.to ? 1 : 0);
}

export type ContactRow = LeadRowData & { list_name: string | null; list_count: number; agent_id: string | null; fit_score?: number | null };

export function contactParams(f: ContactFilters, q: string, extra: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams(Object.entries({
    scope: "all", status: "all", agent_id: f.agent, list_id: f.list, score_band: f.band, email_enrich: f.email, phone_enrich: f.phone,
    interested: f.interested ? "1" : "", replied: f.replied ? "1" : "", signal_type: f.signal, approval: f.approval, step: f.step,
    from: f.from, to: f.to, sort: f.sort, q: q.trim(), ...extra,
  }).filter(([, v]) => v));
}

/** `base`: filters that are always on (a list page passes its list). */
export function useContacts(base: Partial<ContactFilters> = {}) {
  const [filters, setFilters] = useState<ContactFilters>(() => ({ ...EMPTY_FILTERS, ...base }));
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState(100);
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [signals, setSignals] = useState<Array<{ type: string; count: number }>>([]);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => contactParams(filters, q, { limit: String(pageSize), offset: String(page * pageSize), facets: "1" }).toString(), [filters, q, page, pageSize]);
  const load = useCallback(() => fetch(`/api/leads?${query}`)
    .then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not load contacts");
      setRows(d.leads ?? []); setTotal(d.total ?? 0); setSignals(d.facets?.signal ?? []); setError(null);
    })
    .catch((e: Error) => { setError(e.message); setRows((r) => r ?? []); }), [query]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const patch = useCallback((p: Partial<ContactFilters>) => { setFilters((f) => ({ ...f, ...p })); setPage(0); }, []);
  const baseKey = JSON.stringify(base);
  const clear = useCallback(() => { setFilters({ ...EMPTY_FILTERS, ...(JSON.parse(baseKey) as Partial<ContactFilters>) }); setPage(0); }, [baseKey]);
  const search = useCallback((v: string) => { setQ(v); setPage(0); }, []);
  const setPageSize = useCallback((n: number) => { setPageSizeState(n); setPage(0); }, []);
  return { filters, patch, clear, q, search, page, setPage, pageSize, setPageSize, rows, total, signals, error, load };
}
