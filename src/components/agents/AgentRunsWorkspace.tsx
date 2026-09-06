"use client";

import { PaidAgentsWorkspace } from "./PaidAgentsWorkspace";

// Keep the shell contract while paid goals remain independent of brand setup.
export function AgentRunsWorkspace({ canManage }: {
  brandId: string | null;
  canManage: boolean;
  onStartAudit: () => void;
}) {
  return <PaidAgentsWorkspace canManage={canManage} />;
}
