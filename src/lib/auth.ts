import type { Workspace } from "@prisma/client";

import { prisma, isDatabaseConfigured } from "@/lib/db";

/**
 * Auth & tenancy resolution (Stack B). Server-only.
 *
 * Bridges Clerk identity → a Workspace row (org-level multi-tenancy, see
 * prisma/schema.prisma). Mirrors the graceful-without-keys pattern in
 * src/lib/agent/provider.ts, src/lib/db.ts and src/lib/security/vault.ts:
 *
 *   • Importing this module NEVER touches Clerk or the database. Clerk's server
 *     SDK is imported dynamically and only inside the functions that need it, so
 *     `next build` / `tsc --noEmit` stay green with no Clerk env and no DB.
 *   • When Clerk is NOT configured (no publishable + secret key), the app runs
 *     in single-tenant DEV mode: every request resolves to one stable local
 *     workspace (slug "dev"). This keeps the validated mockup working unchanged.
 *   • Only an actual call at runtime (getCurrentWorkspace / requireWorkspace)
 *     touches Clerk or the DB — never at import/build time.
 *
 * The live multi-tenant path activates the moment Clerk + DATABASE_URL are set,
 * behind this same interface; no caller changes.
 */

/** Stable identifiers for the single-tenant local dev workspace (no Clerk). */
const DEV_WORKSPACE_SLUG = "dev";
const DEV_WORKSPACE_NAME = "Local Dev Workspace";

/** A Clerk user must be signed in but mapped to no workspace yet. */
export class WorkspaceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceResolutionError";
  }
}

/** Thrown by requireWorkspace() when auth is configured but no user is present. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

/**
 * True when Clerk is fully configured (publishable + secret key present). Read
 * lazily from env on every call — never at import — so the gate reflects the
 * runtime environment and build stays green with no keys. Use this to decide
 * whether to mount ClerkProvider / the real middleware vs. the dev pass-through.
 */
export function isAuthConfigured(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    Boolean(process.env.CLERK_SECRET_KEY)
  );
}

/**
 * Identity resolved from the current request. In dev (no Clerk) this is a fixed
 * synthetic identity so the workspace mapping is deterministic.
 */
interface ResolvedIdentity {
  /** Clerk user id, or a stable dev sentinel when auth is disabled. */
  clerkUserId: string;
  /** Clerk org id when the user is acting inside an organization, else null. */
  clerkOrgId: string | null;
  /** Human-friendly name for a freshly-created workspace. */
  suggestedName: string;
  /** Slug for a freshly-created workspace (unique per tenant). */
  slug: string;
}

const DEV_IDENTITY: ResolvedIdentity = {
  clerkUserId: "dev-user",
  clerkOrgId: null,
  suggestedName: DEV_WORKSPACE_NAME,
  slug: DEV_WORKSPACE_SLUG,
};

/**
 * Read the signed-in Clerk identity for the current request. Clerk's server SDK
 * is imported dynamically here (never at module load) so this file is safe to
 * import with no Clerk env. Returns null when auth is configured but no user is
 * signed in. When auth is NOT configured, callers short-circuit to DEV_IDENTITY
 * and never reach this function.
 */
async function resolveClerkIdentity(): Promise<ResolvedIdentity | null> {
  // Dynamic import keeps Clerk out of the import graph until it is actually
  // needed at runtime (and only when configured).
  const { auth } = await import("@clerk/nextjs/server");
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return null;

  // Prefer the org as the tenant (Clerk orgs = multi-tenancy). Fall back to a
  // per-user workspace when the user isn't acting inside an org.
  if (orgId) {
    return {
      clerkUserId: userId,
      clerkOrgId: orgId,
      suggestedName: orgSlug ? `Workspace ${orgSlug}` : "Workspace",
      slug: `org-${orgId}`,
    };
  }
  return {
    clerkUserId: userId,
    clerkOrgId: null,
    suggestedName: "Personal workspace",
    slug: `user-${userId}`,
  };
}

/**
 * Find-or-create the Workspace for a resolved identity, ensuring the user has a
 * Membership. Only touches the DB — never called unless DB is configured.
 */
async function findOrCreateWorkspace(
  identity: ResolvedIdentity,
): Promise<Workspace> {
  // Find-or-create by the stable per-tenant slug.
  const existing = await prisma.workspace.findUnique({
    where: { slug: identity.slug },
  });

  const workspace =
    existing ??
    (await prisma.workspace.create({
      data: { name: identity.suggestedName, slug: identity.slug },
    }));

  // Ensure the signed-in user is a member of this workspace (idempotent). The
  // first member of a brand-new workspace is the owner.
  await prisma.membership.upsert({
    where: {
      workspaceId_clerkUserId: {
        workspaceId: workspace.id,
        clerkUserId: identity.clerkUserId,
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      clerkUserId: identity.clerkUserId,
      role: existing ? "member" : "owner",
    },
  });

  return workspace;
}

/**
 * A workspace handle that does not require the database. Returned in dev mode so
 * callers always have a stable tenant identity even with no DB configured. The
 * shape is a subset of the Prisma Workspace; getCurrentWorkspace() returns the
 * full row when the DB is live.
 */
export interface WorkspaceRef {
  id: string;
  name: string;
  slug: string;
  /** True when this is the synthetic single-tenant dev workspace (no Clerk/DB). */
  isDev: boolean;
}

/** The synthetic dev workspace — stable across requests, no DB required. */
const DEV_WORKSPACE: WorkspaceRef = {
  id: "dev-workspace",
  name: DEV_WORKSPACE_NAME,
  slug: DEV_WORKSPACE_SLUG,
  isDev: true,
};

function toRef(w: Workspace): WorkspaceRef {
  return { id: w.id, name: w.name, slug: w.slug, isDev: false };
}

/**
 * Resolve the current request to its Workspace.
 *
 *   • Auth NOT configured → the stable local dev workspace (slug "dev"). No DB
 *     or Clerk access happens. The validated mockup keeps working unchanged.
 *   • Auth configured but DB NOT configured → still returns the dev workspace,
 *     so the app stays green while keys are being wired up incrementally.
 *   • Auth + DB configured, user signed in → the find-or-created Workspace row
 *     (full Prisma row) with the user's Membership ensured.
 *
 * Returns null only when auth is configured and NO user is signed in (callers
 * that require a user should use requireWorkspace()).
 */
export async function getCurrentWorkspace(): Promise<WorkspaceRef | null> {
  // No Clerk → single-tenant dev mode. Deterministic, no I/O.
  if (!isAuthConfigured()) return DEV_WORKSPACE;

  const identity = await resolveClerkIdentity();
  if (!identity) return null; // configured, but no signed-in user

  // Auth on but DB not wired yet: stay green with the dev workspace rather than
  // throwing on a missing DATABASE_URL. The live tenant row appears the moment
  // the DB is configured.
  if (!isDatabaseConfigured()) return DEV_WORKSPACE;

  const workspace = await findOrCreateWorkspace(identity);
  return toRef(workspace);
}

/**
 * Like getCurrentWorkspace() but for API routes that must have a tenant: throws
 * NotAuthenticatedError when auth is configured and no user is signed in.
 *
 * Dev-friendly: with no Clerk configured this always succeeds with the dev
 * workspace, so existing routes keep working without an auth wall.
 */
export async function requireWorkspace(): Promise<WorkspaceRef> {
  const workspace = await getCurrentWorkspace();
  if (!workspace) throw new NotAuthenticatedError();
  return workspace;
}
