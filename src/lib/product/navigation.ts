export type WorkspaceArea = "assistant" | "brand" | "organic" | "paid" | "analytics" | "agents";
export type OrganicWorkspaceView = "calendar" | "studio" | "seo" | "influencers" | "assistant";
export type PaidWorkspaceView = "campaigns";

export interface WorkspaceLocation {
  area: WorkspaceArea;
  view?: OrganicWorkspaceView | PaidWorkspaceView;
}

const AREA_SET = new Set<WorkspaceArea>([
  "assistant",
  "brand",
  "organic",
  "paid",
  "analytics",
  "agents",
]);
const ORGANIC_VIEW_SET = new Set<OrganicWorkspaceView>([
  "calendar",
  "studio",
  "seo",
  "influencers",
  "assistant",
]);

export function parseWorkspaceLocation(
  input: URLSearchParams | string,
): WorkspaceLocation {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const requested = params.get("mode") as WorkspaceArea | null;
  const area = requested && AREA_SET.has(requested) ? requested : "assistant";

  if (area === "organic") {
    const requestedView = params.get("view") as OrganicWorkspaceView | null;
    return {
      area,
      view: requestedView && ORGANIC_VIEW_SET.has(requestedView) ? requestedView : "calendar",
    };
  }
  if (area === "paid") return { area, view: "campaigns" };
  return { area };
}

export function workspaceLocationHref(location: WorkspaceLocation): string {
  const params = new URLSearchParams({ mode: location.area });
  if (location.area === "organic") params.set("view", location.view ?? "calendar");
  if (location.area === "paid") params.set("view", "campaigns");
  return `/app?${params.toString()}`;
}
