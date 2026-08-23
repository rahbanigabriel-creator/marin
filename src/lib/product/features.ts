/**
 * Launch-wide product switches. Keep these deterministic and env-free so the
 * browser, API routes, billing policy, and tests all expose the same contract.
 */
export const LAUNCH_FEATURES = {
  opusResponses: false,
} as const;

export function applyLaunchFeatureGates<T extends { canUseOpus: boolean }>(
  entitlements: T,
): T {
  return {
    ...entitlements,
    canUseOpus: entitlements.canUseOpus && LAUNCH_FEATURES.opusResponses,
  };
}
