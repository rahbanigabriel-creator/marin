import { prisma } from "@/lib/db";
import { isPersistenceModelUnavailable } from "@/lib/persistence/errors";

export async function getWorkspaceTimeZone(workspaceId: string): Promise<string | null> {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { timezone: true },
    });
    return workspace?.timezone ?? null;
  } catch (error) {
    if (isPersistenceModelUnavailable(error)) return null;
    throw error;
  }
}
