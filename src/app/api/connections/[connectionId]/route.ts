import { createDeleteConnectionHandler } from "@/lib/connectors/disconnect-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = createDeleteConnectionHandler();

