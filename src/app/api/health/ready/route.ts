import { isDatabaseConfigured, prisma } from "@/lib/db";
import { createReadinessResponse } from "@/lib/operations/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<Response> {
  return createReadinessResponse({
    pingDatabase: async () => {
      if (!isDatabaseConfigured()) throw new Error("Database unavailable");
      await prisma.$queryRaw`SELECT 1`;
    },
  });
}
