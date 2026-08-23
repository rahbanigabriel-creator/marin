import "server-only";

import {
  WORKSPACE_DELETION_EXECUTE_EVENT,
  inngest,
  isWorkspaceDeletionDispatchConfigured,
} from "@/lib/jobs/inngest";
import type { DeletionDispatchResult } from "@/lib/privacy/deletion/service";

/** Send one signed, replay-safe deletion event and report the honest outcome. */
export async function dispatchWorkspaceDeletion(input: {
  deletionRequestId: string;
  workspaceId: string;
}): Promise<DeletionDispatchResult> {
  if (!isWorkspaceDeletionDispatchConfigured()) return "unavailable";
  try {
    await inngest.send({ name: WORKSPACE_DELETION_EXECUTE_EVENT, data: input });
    return "sent";
  } catch {
    return "failed";
  }
}
