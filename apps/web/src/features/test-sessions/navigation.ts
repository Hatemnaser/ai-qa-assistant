import type { QaRequestPhase } from "../qa/types";

export interface SidebarTestItem {
  id: string;
  projectId: string;
  title: string;
  phase?: QaRequestPhase;
  requestId?: string;
  requestIds?: string[];
  archivedAt?: string | null;
  updatedAt?: string;
}

// List presentation only: never changes the selected request or loads its details.
export function filterTestNavigation(items: SidebarTestItem[], projectId = "", archived = false) {
  return items.filter(item => (!projectId || item.projectId === projectId) && Boolean(item.archivedAt) === archived)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
