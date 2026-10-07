"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateView } from "@/actions/views";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { DayPrefs } from "@/lib/dates/today";
import { runView } from "@/lib/views/engine";
import type { AnyItem } from "@/lib/views/items";
import { lastViewCookie } from "@/lib/views/legacy";
import { applyPatch } from "@/lib/views/patch";
import { GROUP_BY_OPTIONS } from "@/lib/views/properties";
import { projectScope, withQuickFilters } from "@/lib/views/quick";
import type { Collection, ViewConfig, ViewDTO, ViewFilter } from "@/lib/views/types";
import type { EngineContext } from "@/lib/views/values";
import { SavedViewTabs } from "./saved-view-tabs";
import { useViewConfig } from "./use-view-config";
import { ViewSettings } from "./view-settings";
import type { ViewState } from "./view-state";

export type EngineProps = { nowMs: number; weekStart: number; prefs: DayPrefs };

type Props<T extends AnyItem> = {
  collection: Collection;
  views: ViewDTO[];
  activeViewId: string;
  items: T[];
  /** The URL's quick filters (the chips above a list), laid over the view's own. */
  quick: ViewFilter[];
  /** A project page: every view is limited to this project and cannot be widened. */
  projectId: string | null;
  engine: EngineProps;
  basePath: string;
  linkParams?: Record<string, string>;
  /** The chips row; it receives the View settings button to place at its end. */
  toolbar: (settings: React.ReactNode, config: ViewConfig) => React.ReactNode;
  children: (state: ViewState<T>) => React.ReactNode;
};

/**
 * What every collection screen has in common (V2 feature 06 §5): the view tabs, the settings, the
 * view's config as it is edited, the engine run over the items, and a layer of "just changed"
 * values so a drop or a cell edit shows at once. The screens differ only in what they draw.
 */
export function CollectionHost<T extends AnyItem>({
  collection,
  views,
  activeViewId,
  items,
  quick,
  projectId,
  engine,
  basePath,
  linkParams,
  toolbar,
  children,
}: Props<T>) {
  const router = useRouter();
  const { projects, tags } = useWorkspace();
  const view = views.find((v) => v.id === activeViewId) ?? views[0]!;
  const { config, update } = useViewConfig(view);

  // Changes the server has not confirmed yet. Replaced by the server's rows when the page refreshes.
  const [patches, setPatches] = useState<{
    source: readonly T[];
    byId: Record<string, Partial<AnyItem>>;
  }>({ source: items, byId: {} });
  if (patches.source !== items) setPatches({ source: items, byId: {} });

  const patched = useMemo(
    () => items.map((item) => applyPatch(item, patches.byId[item.id])),
    [items, patches],
  );

  const ctx = useMemo<EngineContext>(
    () => ({
      prefs: engine.prefs,
      now: new Date(engine.nowMs),
      weekStart: engine.weekStart,
      projects,
      tags,
    }),
    [engine.prefs, engine.nowMs, engine.weekStart, projects, tags],
  );

  const effective = useMemo(() => {
    const withQuick = withQuickFilters(config, quick);
    const scoped = projectId ? withQuickFilters(withQuick, [projectScope(projectId)]) : withQuick;
    // A board needs something to make columns of.
    return view.type === "BOARD" && !scoped.groupBy
      ? { ...scoped, groupBy: GROUP_BY_OPTIONS[collection][0]!.id }
      : scoped;
  }, [config, quick, projectId, view.type, collection]);

  const result = useMemo(
    () => runView(collection, patched, effective, ctx),
    [collection, patched, effective, ctx],
  );

  // The last view used for this collection is remembered on this device (the server reads it).
  useEffect(() => {
    document.cookie = `${lastViewCookie(collection)}=${view.id}; path=/; max-age=31536000; samesite=lax`;
  }, [collection, view.id]);

  // A saved config that no longer passes the rules was replaced by the default: say so once, and
  // write the default back so it is not said again.
  useEffect(() => {
    if (!view.configReset) return;
    toast("This view's settings were reset.");
    void updateView({ id: view.id, config: view.config });
  }, [view.id, view.configReset, view.config]);

  const state: ViewState<T> = {
    collection,
    view,
    config,
    effective,
    update,
    result,
    items: patched,
    ctx,
    patchItem: (id, patch) =>
      setPatches((now) => ({ ...now, byId: { ...now.byId, [id]: { ...now.byId[id], ...patch } } })),
    revertItem: (id) =>
      setPatches((now) => {
        const { [id]: _removed, ...rest } = now.byId;
        void _removed;
        return { ...now, byId: rest };
      }),
    refresh: () => router.refresh(),
    projectId,
  };

  return (
    <>
      <SavedViewTabs
        collection={collection}
        views={views}
        activeId={view.id}
        basePath={basePath}
        currentFilters={config.filters}
        linkParams={linkParams}
      />
      {toolbar(
        <ViewSettings collection={collection} type={view.type} config={config} update={update} />,
        config,
      )}
      {children(state)}
    </>
  );
}
