import type {
  InfluencerCapability,
  InfluencerCapabilityInput,
} from "@/lib/influencers/types";

export function influencerCapability(
  input: InfluencerCapabilityInput,
): InfluencerCapability {
  const canManage = input.role === "owner" || input.role === "admin";
  return {
    canRead: true,
    canManage,
    contactVisibility: canManage ? "full" : "redacted",
    vendorDiscovery: input.vendorConfigured ? "available" : "unavailable",
    aiAssistance: !input.hasAiEntitlement
      ? "upgrade_required"
      : input.aiConfigured
        ? "available"
        : "unavailable",
    outreachExecution: "assisted",
  };
}

export function redactInfluencerContact<T extends {
  contactEmail: string | null;
  contactName: string | null;
}>(profile: T, capability: InfluencerCapability): T {
  if (capability.contactVisibility === "full") return profile;
  return { ...profile, contactEmail: null, contactName: null };
}
