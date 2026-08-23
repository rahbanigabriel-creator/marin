export interface RuntimeConfigurationInput {
  nodeEnv: string | undefined;
  isVercel: boolean;
  e2eBypass: boolean;
  authConfigured: boolean;
  databaseConfigured: boolean;
}

export type RuntimeConfigurationIssue =
  | "authentication_not_configured"
  | "database_not_configured";

export function isolatedE2eBypassAllowed(input: {
  isVercel: boolean;
  e2eBypass: boolean;
}): boolean {
  return input.e2eBypass && !input.isVercel;
}

/**
 * Credential-free operation is reserved for development and the isolated local
 * browser-test launcher. A deployed production process must fail closed rather
 * than silently granting the synthetic development owner.
 */
export function runtimeConfigurationIssue(
  input: RuntimeConfigurationInput,
): RuntimeConfigurationIssue | null {
  const isolatedE2e = isolatedE2eBypassAllowed(input);
  if (input.nodeEnv !== "production" || isolatedE2e) return null;
  if (!input.authConfigured) return "authentication_not_configured";
  if (!input.databaseConfigured) return "database_not_configured";
  return null;
}

export function syntheticWorkspaceAllowed(input: {
  nodeEnv: string | undefined;
  isVercel: boolean;
  e2eBypass: boolean;
}): boolean {
  return runtimeConfigurationIssue({
    ...input,
    authConfigured: false,
    databaseConfigured: false,
  }) === null;
}
