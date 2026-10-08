import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_FILTERS, type Facets, type Filters, type LeadRowData } from "./types";

export const PAGE_SIZE = 50;

/** Query-string params for /api/leads from the table's filters. Empty values are left out. */
export function leadsParams(agent: string, filters: Filters, q: string, extra: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams(Object.entries({
    agent_id: agent, status: filters.status, step: filters.step, approval: filters.approval, email_enrich: filters.email,
    phone_enrich: filters.phone, signal_type: filters.signal, sort: filters.sort, q: q.trim(), ...extra,
  }).filter(([, v]) => v));
}

/** Default filters, with the signal type from `?signal=` (Activity → View leads) when present. */
function initialFilters(): Filters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  const signal = new URLSearchParams(window.location.search).get("signal") ?? "";
  return /^[a-z_]{1,40}$/.test(signal) ? { ...DEFAULT_FILTERS, signal } : DEFAULT_FILTERS;
}

/** Filters, paging and the fetched page (with facet counts) for the Leads table. */
export function useLeadsQuery(agent: string) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<LeadRowData[] | null>(null);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => leadsParams(agent, filters, q, { limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), facets: "1" }).toString(), [agent, filters, q, page]);
  const load = useCallback(() => fetch(`/api/leads?${query}`)
    .then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not load leads");
      setRows(d.leads ?? []); setTotal(d.total ?? 0); setFacets(d.facets ?? null); setError(null);
    })
    .catch((e: Error) => { setError(e.message); setRows((r) => r ?? []); }), [query]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const patch = useCallback((p: Partial<Filters>) => { setFilters((f) => ({ ...f, ...p })); setPage(0); }, []);
  const search = useCallback((v: string) => { setQ(v); setPage(0); }, []);
  const clearFilters = useCallback(() => { setFilters((f) => ({ ...DEFAULT_FILTERS, status: f.status })); setPage(0); }, []);

  return { filters, patch, clearFilters, q, search, page, setPage, rows, total, facets, error, load };
}
