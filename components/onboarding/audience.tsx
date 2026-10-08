import type { Icp } from "@/lib/icp/schema";
import { ChipAdd, ChipSelect, COMPANY_SIZES, COMPANY_TYPES, PEOPLE_EXCLUDES, RoleChips, SectionLabel, Title, buyerTitles, filled, withTitles } from "@/components/onboarding/fields";

export function RolesStep({ icp, onIcp }: { icp: Icp; onIcp: (icp: Icp) => void }) {
  return (
    <div>
      <Title title="Who's your ideal customer?" text="We pre-filled this based on your website, adjust or add if needed. We will automatically match similar job titles, no need to be exhaustive." />
      <RoleChips values={buyerTitles(icp)} onChange={(titles) => onIcp(withTitles(icp, titles))} />
    </div>
  );
}

export function CompaniesStep({ icp, onIcp, industries, locations }: { icp: Icp; onIcp: (icp: Icp) => void; industries: string[]; locations: string[] }) {
  const set = <K extends keyof Icp>(key: K, value: Icp[K]) => onIcp({ ...icp, [key]: value });
  return (
    <div className="space-y-5">
      <Title title="What kind of companies are you targeting?" text="We pre-filled this based on your website, adjust or add if needed." />
      <div>
        <SectionLabel>Industry</SectionLabel>
        <ChipSelect allLabel="All industries" options={industries} selected={icp.industries} onChange={(next) => set("industries", next)} allowAdd addLabel="Industry" />
      </div>
      <div>
        <SectionLabel>Location</SectionLabel>
        <ChipSelect allLabel="All locations" options={locations} selected={icp.geographies} onChange={(geographies) => set("geographies", geographies)} allowAdd addLabel="Location" />
      </div>
      <div>
        <SectionLabel>Company types</SectionLabel>
        <ChipSelect allLabel="All company types" options={[...COMPANY_TYPES, ...icp.company_types]} selected={icp.company_types} onChange={(company_types) => set("company_types", company_types)} />
      </div>
      <div>
        <SectionLabel>Company size</SectionLabel>
        <ChipSelect allLabel="All company sizes" options={[...COMPANY_SIZES, ...icp.company_sizes]} selected={icp.company_sizes} onChange={(company_sizes) => set("company_sizes", company_sizes)} />
      </div>
    </div>
  );
}

export function ExcludeStep({ icp, onIcp }: { icp: Icp; onIcp: (icp: Icp) => void }) {
  const custom = icp.exclusions.filter((item) => !PEOPLE_EXCLUDES.includes(item));
  const toggle = (label: string, on: boolean) => onIcp({ ...icp, exclusions: on ? [...icp.exclusions.filter((item) => item !== label), label] : icp.exclusions.filter((item) => item !== label) });
  return (
    <div className="space-y-5">
      <Title title="Who should we exclude?" text="We pre-filled this based on your website, adjust or add if needed." />
      <div>
        <SectionLabel>Exclude these profiles</SectionLabel>
        <div className="space-y-2">
          {PEOPLE_EXCLUDES.map((label) => (
            <label key={label} className="flex cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={icp.exclusions.includes(label)} onChange={(e) => toggle(label, e.target.checked)} />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div>
        <SectionLabel>Companies & keywords to avoid</SectionLabel>
        <ChipAdd values={filled(custom)} onChange={(extra) => onIcp({ ...icp, exclusions: [...icp.exclusions.filter((item) => PEOPLE_EXCLUDES.includes(item)), ...extra] })} placeholder="e.g. Salesforce, Recruiter" />
        <p className="mt-2 text-xs text-base-content/40">You can fine-tune location and keywords again before the lead preview.</p>
      </div>
    </div>
  );
}
