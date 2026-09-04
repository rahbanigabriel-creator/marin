import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import type { PaidLaunchTemplate } from "./types";

type Schema = Record<string, unknown>;
const text = (maxLength: number): Schema => ({ type: "string", minLength: 1, maxLength });
const nullableText = (maxLength: number): Schema => ({ anyOf: [text(maxLength), { type: "null" }] });
const choice = (...values: string[]): Schema => ({ type: "string", enum: values });
const list = (items: Schema, minItems: number, maxItems: number): Schema => ({
  type: "array", items, minItems, maxItems,
});
const object = (properties: Record<string, Schema>): Schema => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
const identifier = { ...text(191), pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" };

/** The generation contract excludes all server-owned identity and approval fields. */
export function paidDraftGenerationSchema(template: PaidLaunchTemplate): Tool.InputSchema {
  const search = template === "google_search_rsa";
  const meta = template === "meta_traffic" || template === "meta_lead";
  const targeting = object({
    kind: choice(search ? "search" : "audience"),
    locations: list(text(100), 1, 50),
    languages: list(text(40), 1, 20),
    ...(search ? {
      keywords: list(object({ text: text(80), matchType: choice("broad", "phrase", "exact") }), 1, 100),
      negativeKeywords: list(text(80), 0, 100),
    } : {
      ageMin: { type: "integer", minimum: 13, maximum: 65 },
      ageMax: { type: "integer", minimum: 13, maximum: 65, description: "At least ageMin." },
      genders: { ...list(choice("all", "female", "male"), 1, 3), description: "Use all alone, never with another gender." },
      interests: list(text(100), 0, 100),
    }),
  });
  const ad = object({
    localId: identifier,
    name: text(128),
    format: search ? choice("responsive_search") : meta ? choice("image", "video") : choice("video"),
    assetIds: list(identifier, search ? 0 : 1, search ? 0 : 1),
    destinationUrl: { ...text(2048), description: "Exact supplied brand HTTPS URL. Do not invent a landing page." },
    ...(search ? {
      headlines: list(text(30), 3, 15),
      descriptions: list(text(90), 2, 4),
      path1: nullableText(15),
      path2: nullableText(15),
    } : {
      primaryText: text(2200),
      headline: text(255),
      ...(meta ? { description: nullableText(500) } : {}),
      callToAction: choice("contact_us", "download", "learn_more", "shop_now", "sign_up"),
    }),
  });
  const objective = template === "meta_lead" ? "leads" : template === "tiktok_conversion" ? "conversions" : "traffic";
  return {
    type: "object",
    properties: {
      campaign: object({ name: text(160), objective: choice(objective) }),
      budget: object({
        amountMinor: { type: "integer", minimum: 1, maximum: 9_000_000_000_000, description: "Minor currency units: EUR 5 is 500 cents." },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        cadence: choice("daily", "lifetime"),
      }),
      schedule: object({
        startsDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Future local date in requiredTimezone, YYYY-MM-DD. Use suggestedSchedule unless a different future date was requested." },
        startsTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: "Local start time in requiredTimezone, HH:mm." },
        durationDays: { type: "integer", minimum: 1, maximum: 365, description: "Requested number of calendar days; one week is 7. Default 7. Server calculates the end at the same local time, including DST." },
      }),
      adGroups: list(object({ localId: identifier, name: text(128), targeting, ads: list(ad, 1, 20) }), 1, 20),
      assumptions: list(text(500), 0, 12),
    },
    required: ["campaign", "budget", "schedule", "adGroups", "assumptions"],
    additionalProperties: false,
  };
}
