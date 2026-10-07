import type { ViewResult } from "@/lib/views/engine";
import type { AnyItem } from "@/lib/views/items";
import type { Collection, ViewConfig, ViewDTO } from "@/lib/views/types";
import type { EngineContext } from "@/lib/views/values";

/** Everything the host hands to the view that is showing the items. */
export type ViewState<T extends AnyItem = AnyItem> = {
  collection: Collection;
  view: ViewDTO;
  /** The view's own settings, as edited. */
  config: ViewConfig;
  /** The settings with the URL's quick filters and a project page's scope laid over them. */
  effective: ViewConfig;
  update: (change: (config: ViewConfig) => ViewConfig) => void;
  result: ViewResult<T>;
  /** All the items read for this view, with changes not yet confirmed by the server applied. */
  items: T[];
  ctx: EngineContext;
  /** Show a change now; the server's answer replaces it when the page refreshes. */
  patchItem: (id: string, patch: Partial<AnyItem>) => void;
  /** Take back a change that did not go through. */
  revertItem: (id: string) => void;
  /** Reload the page's data from the server. */
  refresh: () => void;
  /** A project page: the project every item here belongs to. */
  projectId: string | null;
};
