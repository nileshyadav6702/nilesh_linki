import { RiListUnordered } from "react-icons/ri";
import { IconTile } from "@/components/agents/ui";
import { PanelHeader, SearchSelect, SubHeading, TrackedRow } from "@/components/agents/sources/kit";

export interface ListRow { id: string; name: string; target_count: number }

/**
 * "Saved list": pick a workspace list to feed the agent. Lists the agent already uses (attached,
 * staged, or its own lead list) are struck through and cannot be picked. Changes are staged
 * and saved with the drawer.
 */
export default function SavedListPanel({ lists, attached, ownListId, attach, detach, onAttach, onDetach, loading }: {
  lists: ListRow[]; attached: string[]; ownListId: string | null; attach: string[]; detach: string[];
  onAttach: (id: string) => void; onDetach: (id: string) => void; loading: boolean;
}) {
  const active = [...attached.filter((id) => !detach.includes(id)), ...attach];
  const used = new Set([...active, ...(ownListId ? [ownListId] : [])]);
  const options = lists.map((l) => ({
    value: l.id, label: `${l.name} (${l.target_count} lead${l.target_count === 1 ? "" : "s"})`,
    disabled: used.has(l.id), note: used.has(l.id) ? "(already used)" : undefined,
  }));
  const byId = new Map(lists.map((l) => [l.id, l]));

  return (
    <div className="space-y-6">
      <PanelHeader title="Saved list" description="Add the leads of a list you already have to this agent." />
      <div className="space-y-2">
        <span className="text-[15px] font-medium text-base-content">Lead list <span className="text-error">*</span></span>
        <SearchSelect value="" options={options} onChange={onAttach} placeholder={loading ? "Loading lists…" : "Choose a list…"} label="Lead list" />
        <p className="text-[14.5px] text-base-content/55">The agent picks up the list&apos;s contacts on its next run. A contact already handled by another agent stays with that agent.</p>
      </div>
      <div>
        <SubHeading>Lists feeding this agent ({active.length})</SubHeading>
        <div className="mt-2">
          {active.map((id) => {
            const l = byId.get(id);
            const staged = attach.includes(id);
            return (
              <TrackedRow key={id} lead={<IconTile icon={<RiListUnordered size={16} />} tone="ink" size={36} />}
                title={l?.name ?? "Deleted list"} sub={`${l ? `${l.target_count} leads` : "No longer in your workspace"}${staged ? " · added, not saved yet" : ""}`}
                onRemove={() => onDetach(id)} />
            );
          })}
          {!active.length && <p className="py-3 text-[15px] text-base-content/45">No lists attached yet.</p>}
        </div>
      </div>
    </div>
  );
}
