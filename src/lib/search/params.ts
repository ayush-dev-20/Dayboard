import { isValidDateString } from "../dates/calendar";
import { TASK_STATUSES, type TaskStatus } from "../tasks/status";
import { SEARCH_TABS, type SearchParams, type SearchTab } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads the /search URL. Anything unrecognised is ignored rather than failing. `q` is returned as typed. */
export function parseSearchUrl(raw: Raw): Omit<SearchParams, "q"> & { q: string } {
  const tab = first(raw.type);
  const status = first(raw.status)?.toUpperCase();
  const project = first(raw.project);
  const tag = first(raw.tag);
  const from = first(raw.from);
  const to = first(raw.to);
  return {
    q: (first(raw.q) ?? "").slice(0, 400),
    tab: (SEARCH_TABS as readonly string[]).includes(tab ?? "") ? (tab as SearchTab) : "all",
    status: (TASK_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as TaskStatus)
      : null,
    projectId: project === "none" ? "none" : project && UUID.test(project) ? project : null,
    tagId: tag && UUID.test(tag) ? tag : null,
    from: from && isValidDateString(from) ? from : null,
    to: to && isValidDateString(to) ? to : null,
  };
}

/** The query string for the Search page's current choices. */
export function buildSearchUrl(p: Partial<Omit<SearchParams, "q">> & { q?: string }): string {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  if (p.tab && p.tab !== "all") q.set("type", p.tab);
  if (p.status) q.set("status", p.status.toLowerCase());
  if (p.projectId) q.set("project", p.projectId);
  if (p.tagId) q.set("tag", p.tagId);
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  const text = q.toString();
  return text ? `/search?${text}` : "/search";
}
