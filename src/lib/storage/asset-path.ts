export function assetBlobPrefix(workspaceId: string, assetId: string): string {
  return `ws/${workspaceId}/${assetId}/`;
}

export function assetBlobPath(workspaceId: string, assetId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "asset";
  return `${assetBlobPrefix(workspaceId, assetId)}${safe}`;
}
