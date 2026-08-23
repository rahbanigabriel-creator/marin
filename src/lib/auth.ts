import { randomUUID } from "node:crypto";

import { prisma, isDatabaseConfigured } from "@/lib/db";
import { resolveWorkspaceBillingPolicy } from "@/lib/billing/entitlements";
import { syntheticWorkspaceAllowed } from "@/lib/security/runtime-config";

/**
 * Auth & tenancy resolution (Stack B). Server-only.
 *
 * Bridges Clerk identity → a Workspace row (org-level multi-tenancy, see
 * prisma/schema.prisma). It remains import-safe without credentials while
 * separating local development from deployed production:
 *
 *   • Importing this module NEVER touches Clerk or the database. Clerk's server
 *     SDK is imported dynamically and only inside the functions that need it, so
 *     `next build` / `tsc --noEmit` stay green with no Clerk env and no DB.
 *   • When Clerk is NOT configured, local development may use one stable dev
 *     workspace. Deployed production fails closed before issuing that identity.
 *   • Only an actual call at runtime (getCurrentWorkspace / requireWorkspace)
 *     touches Clerk or the DB — never at import/build time.
 *
 * The multi-tenant path activates when Clerk + DATABASE_URL are set behind the
 * same interface; production requires that path.
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

/** A new user cannot join because the workspace has reached its plan seat cap. */
export class WorkspaceSeatLimitError extends WorkspaceResolutionError {
  readonly code = "workspace_seat_limit" as const;

  constructor(
    readonly workspaceId: string,
    readonly maxSeats: number,
  ) {
    super(`Workspace seat limit reached (${maxSeats})`);
    this.name = "WorkspaceSeatLimitError";
  }
}

export type WorkspaceRole = "owner" | "admin" | "member";

type TrustedClerkOrganizationRole = "org:admin" | "org:member";

export class WorkspaceAuthorizationError extends Error {
  constructor(message = "Not authorized for this workspace action") {
    super(message);
    this.name = "WorkspaceAuthorizationError";
  }
}

export class WorkspaceRoleClaimError extends WorkspaceAuthorizationError {
  readonly code = "workspace_role_claim_invalid" as const;

  constructor() {
    super("A trusted Clerk organization role is required");
    this.name = "WorkspaceRoleClaimError";
  }
}

/** Destructive account operations must never fall back to the synthetic dev user. */
export class AuthConfigurationRequiredError extends Error {
  readonly code = "auth_configuration_required" as const;

  constructor() {
    super("Production authentication is required for this operation");
    this.name = "AuthConfigurationRequiredError";
  }
}

/** A durable deletion tombstone prevents bootstrap and all normal access. */
export class WorkspaceDeletionBlockedError extends WorkspaceResolutionError {
  readonly code = "workspace_deletion_blocked" as const;

  constructor(readonly deletionStatus: string) {
    super("This workspace is being deleted or has already been deleted");
    this.name = "WorkspaceDeletionBlockedError";
  }
}

/** Only a Clerk organization admin may establish its first Marpin owner. */
export class WorkspaceAdminRequiredError extends WorkspaceAuthorizationError {
  readonly code = "workspace_admin_required" as const;

  constructor(readonly workspaceId: string) {
    super("A Clerk organization admin must initialize this workspace");
    this.name = "WorkspaceAdminRequiredError";
  }
}

export function isWorkspaceAdminRequiredError(
  error: unknown,
): error is WorkspaceAdminRequiredError {
  return (
    error instanceof WorkspaceAdminRequiredError ||
    (error instanceof Error &&
      "code" in error &&
      error.code === "workspace_admin_required")
  );
}

export function isWorkspaceSeatLimitError(
  error: unknown,
): error is WorkspaceSeatLimitError {
  return (
    error instanceof WorkspaceSeatLimitError ||
    (error instanceof Error &&
      "code" in error &&
      error.code === "workspace_seat_limit")
  );
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
 * runtime environment and build stays green with no keys. Production request
 * paths fail closed when this returns false; only local development may use the
 * synthetic workspace.
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
export interface ResolvedIdentity {
  /** Clerk user id, or a stable dev sentinel when auth is disabled. */
  clerkUserId: string;
  /** Clerk org id when the user is acting inside an organization, else null. */
  clerkOrgId: string | null;
  /** Clerk organization role when acting inside an org. */
  clerkOrgRole: string | null;
  /** Human-friendly name for a freshly-created workspace. */
  suggestedName: string;
  /** Slug for a freshly-created workspace (unique per tenant). */
  slug: string;
}

function trustedClerkOrganizationRole(
  identity: Pick<ResolvedIdentity, "clerkOrgId" | "clerkOrgRole">,
): TrustedClerkOrganizationRole | null {
  if (!identity.clerkOrgId) return null;
  if (
    identity.clerkOrgRole === "org:admin" ||
    identity.clerkOrgRole === "org:member"
  ) {
    return identity.clerkOrgRole;
  }
  throw new WorkspaceRoleClaimError();
}

function persistedWorkspaceRole(role: string): WorkspaceRole {
  if (role === "owner" || role === "admin" || role === "member") return role;
  throw new WorkspaceRoleClaimError();
}

/** @internal Exported for the trusted-claim authorization contract tests. */
export function reconcilePersistedWorkspaceRole(
  persistedRole: string,
  identity: Pick<ResolvedIdentity, "clerkOrgId" | "clerkOrgRole">,
): WorkspaceRole {
  const currentRole = persistedWorkspaceRole(persistedRole);
  const clerkRole = trustedClerkOrganizationRole(identity);

  // Personal workspaces have no organization authority to reconcile against.
  if (!clerkRole) return currentRole;
  if (clerkRole === "org:member") return "member";

  // Preserve the original organization owner while Clerk still vouches for
  // admin access. A demoted owner becomes a member and a later promotion
  // restores admin access without silently recreating ownership.
  return currentRole === "owner" ? "owner" : "admin";
}

const DEV_IDENTITY: ResolvedIdentity = {
  clerkUserId: "dev-user",
  clerkOrgId: null,
  clerkOrgRole: null,
  suggestedName: DEV_WORKSPACE_NAME,
  slug: DEV_WORKSPACE_SLUG,
};

function canUseSyntheticWorkspace(): boolean {
  return syntheticWorkspaceAllowed({
    nodeEnv: process.env.NODE_ENV,
    isVercel: process.env.VERCEL === "1",
    e2eBypass: process.env.MARPIN_E2E === "1",
  });
}

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
  const { userId, orgId, orgRole, orgSlug } = await auth();
  if (!userId) return null;

  // Prefer the org as the tenant (Clerk orgs = multi-tenancy). Fall back to a
  // per-user workspace when the user isn't acting inside an org.
  if (orgId) {
    return {
      clerkUserId: userId,
      clerkOrgId: orgId,
      clerkOrgRole: orgRole ?? null,
      suggestedName: orgSlug ? `Workspace ${orgSlug}` : "Workspace",
      slug: `org-${orgId}`,
    };
  }
  return {
    clerkUserId: userId,
    clerkOrgId: null,
    clerkOrgRole: null,
    suggestedName: "Personal workspace",
    slug: `user-${userId}`,
  };
}

/**
 * Resolve only a real Clerk identity. Unlike requireWorkspace(), this never
 * creates a workspace and never returns the synthetic keyless-development user.
 * It is the safe entry point for deletion status/retry after a tombstone exists.
 */
export async function requireClerkIdentity(): Promise<ResolvedIdentity> {
  if (!isAuthConfigured()) throw new AuthConfigurationRequiredError();
  const identity = await resolveClerkIdentity();
  if (!identity) throw new NotAuthenticatedError();
  return identity;
}

/**
 * Find-or-create the Workspace for a resolved identity, ensuring the user has a
 * Membership. Only touches the DB — never called unless DB is configured.
 */
interface WorkspaceAdmission {
  workspace: WorkspaceIdentity;
  role: WorkspaceRole;
}

async function findOrCreateWorkspaceAdmission(
  identity: ResolvedIdentity,
): Promise<WorkspaceAdmission> {
  const clerkOrgRole = trustedClerkOrganizationRole(identity);

  return prisma.$transaction(async (tx) => {
    const deletion = await tx.workspaceDeletionRequest.findUnique({
      where: { workspaceSlug: identity.slug },
      select: { status: true },
    });
    if (deletion) throw new WorkspaceDeletionBlockedError(deletion.status);

    // Prisma's emulated upsert can lose a concurrent create race with P2002.
    // Native ON CONFLICT makes both callers converge on one canonical row.
    await tx.$executeRaw`
      INSERT INTO "workspaces" ("id", "name", "slug", "created_at", "updated_at")
      VALUES (${randomUUID()}, ${identity.suggestedName}, ${identity.slug}, NOW(), NOW())
      ON CONFLICT ("slug") DO NOTHING
    `;
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { slug: identity.slug },
      // Keep workspace bootstrap compatible while the Sprint 0 migration rolls
      // out. Selecting the full row would ask older databases for the new locale,
      // timezone, and currency columns before that migration has landed.
      select: { id: true, name: true, slug: true },
    });

    // Serialize every admission decision for this tenant. This also makes the
    // first owner deterministic when two first requests arrive together.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "workspaces"
      WHERE "id" = ${workspace.id}
      FOR UPDATE
    `;

    const existingMembership = await tx.membership.findUnique({
      where: {
        workspaceId_clerkUserId: {
          workspaceId: workspace.id,
          clerkUserId: identity.clerkUserId,
        },
      },
      select: { id: true, role: true },
    });
    if (existingMembership) {
      const role = reconcilePersistedWorkspaceRole(
        existingMembership.role,
        identity,
      );
      if (role !== existingMembership.role) {
        await tx.membership.update({
          where: { id: existingMembership.id },
          data: { role },
        });
      }
      return { workspace, role };
    }

    const membershipCount = await tx.membership.count({
      where: { workspaceId: workspace.id },
    });

    // An empty Clerk organization is not evidence that the first visitor owns
    // it. Require Clerk's admin role to establish the canonical Marpin owner.
    // Personal workspaces have no org id and continue to bootstrap their user.
    if (
      membershipCount === 0 &&
      identity.clerkOrgId &&
      clerkOrgRole !== "org:admin"
    ) {
      throw new WorkspaceAdminRequiredError(workspace.id);
    }

    // Billing lookup is inside the same locked transaction. Any lookup failure
    // aborts admission, so missing or unavailable billing state cannot bypass a
    // plan's seat entitlement.
    const policy = await resolveWorkspaceBillingPolicy(workspace.id, tx);
    if (membershipCount >= policy.entitlements.maxSeats) {
      throw new WorkspaceSeatLimitError(
        workspace.id,
        policy.entitlements.maxSeats,
      );
    }

    const initialRole: WorkspaceRole =
      membershipCount === 0
        ? "owner"
        : clerkOrgRole === "org:admin"
          ? "admin"
          : "member";
    await tx.membership.create({
      data: {
        workspaceId: workspace.id,
        clerkUserId: identity.clerkUserId,
        role: initialRole,
      },
    });

    return { workspace, role: initialRole };
  });
}

/** @internal Exported so the transactional admission contract can be tested. */
export async function findOrCreateWorkspace(
  identity: ResolvedIdentity,
): Promise<WorkspaceIdentity> {
  const admission = await findOrCreateWorkspaceAdmission(identity);
  return admission.workspace;
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

type WorkspaceIdentity = Pick<WorkspaceRef, "id" | "name" | "slug">;

/** The synthetic dev workspace — stable across requests, no DB required. */
const DEV_WORKSPACE: WorkspaceRef = {
  id: "dev-workspace",
  name: DEV_WORKSPACE_NAME,
  slug: DEV_WORKSPACE_SLUG,
  isDev: true,
};

function toRef(w: WorkspaceIdentity): WorkspaceRef {
  return { id: w.id, name: w.name, slug: w.slug, isDev: false };
}

/**
 * Resolve the current request to its Workspace.
 *
 *   • Auth NOT configured → the stable local dev workspace (slug "dev") only
 *     outside deployed production.
 *   • Auth configured but DB NOT configured → local development may use the dev
 *     workspace; deployed production throws instead of granting synthetic access.
 *   • Auth + DB configured, user signed in → the find-or-created Workspace row
 *     (full Prisma row) with the user's Membership ensured.
 *
 * Returns null only when auth is configured and NO user is signed in (callers
 * that require a user should use requireWorkspace()).
 */
export async function getCurrentWorkspace(): Promise<WorkspaceRef | null> {
  // No Clerk → single-tenant dev mode. If a DB is configured, create a real
  // workspace row so local connector tests can persist Connection/MetricFact
  // rows under valid foreign keys; otherwise stay synthetic and I/O-free.
  if (!isAuthConfigured()) {
    if (!canUseSyntheticWorkspace()) throw new AuthConfigurationRequiredError();
    if (!isDatabaseConfigured()) return DEV_WORKSPACE;
    return toRef(await findOrCreateWorkspace(DEV_IDENTITY));
  }

  const identity = await resolveClerkIdentity();
  if (!identity) return null; // configured, but no signed-in user

  // Local development can stay usable while its database is being configured.
  // Production must never collapse signed-in users into a shared dev tenant.
  if (!isDatabaseConfigured()) {
    if (!canUseSyntheticWorkspace()) {
      throw new WorkspaceResolutionError("Production database configuration is required");
    }
    return DEV_WORKSPACE;
  }

  const workspace = await findOrCreateWorkspace(identity);
  return toRef(workspace);
}

/**
 * Like getCurrentWorkspace() but for API routes that must have a tenant: throws
 * NotAuthenticatedError when auth is configured and no user is signed in.
 *
 * Dev-friendly: local keyless development succeeds with the dev workspace.
 * Production without Clerk is rejected before a synthetic identity is issued.
 */
export async function requireWorkspace(): Promise<WorkspaceRef> {
  const workspace = await getCurrentWorkspace();
  if (!workspace) throw new NotAuthenticatedError();
  return workspace;
}

export interface WorkspaceAccess {
  workspace: WorkspaceRef;
  clerkUserId: string;
  role: WorkspaceRole;
}

/**
 * Resolve the caller and enforce a workspace role at the server boundary.
 * Local/keyless development is a stable owner; production always checks the
 * persisted Membership instead of trusting a role supplied by the browser.
 */
export async function requireWorkspaceRole(
  allowed: readonly WorkspaceRole[],
): Promise<WorkspaceAccess> {
  if (isAuthConfigured() && isDatabaseConfigured()) {
    const identity = await resolveClerkIdentity();
    if (!identity) throw new NotAuthenticatedError();

    const admission = await findOrCreateWorkspaceAdmission(identity);
    const workspace = toRef(admission.workspace);
    if (!allowed.includes(admission.role)) {
      throw new WorkspaceAuthorizationError();
    }
    return {
      workspace,
      clerkUserId: identity.clerkUserId,
      role: admission.role,
    };
  }

  const workspace = await requireWorkspace();
  if (!isAuthConfigured() || !isDatabaseConfigured() || workspace.isDev) {
    if (!canUseSyntheticWorkspace()) throw new AuthConfigurationRequiredError();
    if (!allowed.includes("owner")) throw new WorkspaceAuthorizationError();
    return { workspace, clerkUserId: DEV_IDENTITY.clerkUserId, role: "owner" };
  }

  throw new WorkspaceAuthorizationError();
}
