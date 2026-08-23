import type {
  GoogleResponsiveSearchAdSnapshot,
  GoogleSearchAdGroupSnapshot,
  GoogleSearchTargetingSnapshot,
  MetaAdGroupSnapshot,
  MetaCreativeAdSnapshot,
  PaidAccountIdentity,
  PaidBudgetSnapshot,
  PaidCampaignObjective,
  PaidCampaignSnapshotV1,
  PaidDraftSource,
  PaidLaunchTemplate,
  PaidPlatform,
  PaidScheduleSnapshot,
  SearchKeywordSnapshot,
  SocialCallToAction,
  SocialGender,
  SocialTargetingSnapshot,
  TikTokAdGroupSnapshot,
  TikTokVideoAdSnapshot,
} from "./types";

type JsonObject = Record<string, unknown>;

const PLATFORM_VALUES = new Set<PaidPlatform>(["google_ads", "meta_ads", "tiktok_ads"]);
const SOURCE_VALUES = new Set<PaidDraftSource>(["manual", "ai"]);
const TEMPLATE_VALUES = new Set<PaidLaunchTemplate>([
  "google_search_rsa",
  "meta_traffic",
  "meta_lead",
  "tiktok_traffic",
  "tiktok_conversion",
]);
const OBJECTIVE_VALUES = new Set<PaidCampaignObjective>(["traffic", "leads", "conversions"]);
const CTA_VALUES = new Set<SocialCallToAction>([
  "contact_us",
  "download",
  "learn_more",
  "shop_now",
  "sign_up",
]);
const GENDER_VALUES = new Set<SocialGender>(["all", "female", "male"]);
const MATCH_TYPE_VALUES = new Set<SearchKeywordSnapshot["matchType"]>([
  "broad",
  "phrase",
  "exact",
]);
const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const EXPLICIT_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_BUDGET_MINOR = 9_000_000_000_000;
const MAX_SCHEDULE_MS = 366 * 24 * 60 * 60 * 1_000;

export class PaidDraftValidationError extends Error {
  readonly name = "PaidDraftValidationError";

  constructor(
    readonly code: string,
    message: string,
    readonly path: string,
  ) {
    super(message);
  }
}

export interface PaidSnapshotParseContext {
  readonly expectedPlatform?: PaidPlatform;
  readonly expectedConnectionId?: string;
  readonly expectedAccountId?: string;
}

function fail(code: string, path: string, message: string): never {
  throw new PaidDraftValidationError(code, message, path);
}

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("invalid_object", path, `${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail("invalid_object", path, `${path} must be a plain object`);
  }
  return value as JsonObject;
}

function onlyKeys(value: JsonObject, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) {
    fail("unknown_field", `${path}.${unknown}`, `${path}.${unknown} is not supported`);
  }
}

function requiredText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string") {
    return fail("invalid_text", path, `${path} must be text`);
  }
  const normalized = value.trim();
  if (!normalized) {
    return fail("required", path, `${path} is required`);
  }
  if (normalized.length > maximum) {
    return fail("too_long", path, `${path} must be ${maximum} characters or fewer`);
  }
  return normalized;
}

function nullableText(value: unknown, path: string, maximum: number): string | null {
  if (value === null) return null;
  return requiredText(value, path, maximum);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  path: string,
): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    return fail("invalid_enum", path, `${path} has an unsupported value`);
  }
  return value as T;
}

function list(value: unknown, path: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value)) {
    return fail("invalid_array", path, `${path} must be an array`);
  }
  if (value.length < minimum || value.length > maximum) {
    return fail(
      "array_size",
      path,
      `${path} must contain between ${minimum} and ${maximum} items`,
    );
  }
  return value;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string, path: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = key(item).toLocaleLowerCase("en-US");
    if (seen.has(normalized)) {
      fail("duplicate_value", path, `${path} cannot contain duplicates`);
    }
    seen.add(normalized);
  }
}

function textList(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  itemMaximum: number,
): string[] {
  const result = list(value, path, minimum, maximum).map((item, index) =>
    requiredText(item, `${path}[${index}]`, itemMaximum),
  );
  uniqueBy(result, (item) => item, path);
  return result;
}

function identifier(value: unknown, path: string): string {
  const result = requiredText(value, path, 191);
  if (!IDENTIFIER.test(result)) {
    fail("invalid_identifier", path, `${path} contains unsafe characters`);
  }
  return result;
}

function safeInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return fail(
      "invalid_integer",
      path,
      `${path} must be a safe integer from ${minimum} to ${maximum}`,
    );
  }
  return Number(value);
}

function parseCurrency(value: unknown): string {
  const currency = requiredText(value, "budget.currency", 3);
  if (!/^[A-Z]{3}$/.test(currency) || !CURRENCIES.has(currency)) {
    fail("invalid_currency", "budget.currency", "budget.currency must be an ISO 4217 code");
  }
  return currency;
}

interface ParsedInstant {
  readonly iso: string;
  readonly date: Date;
  readonly offsetMinutes: number;
}

function parseInstant(value: unknown, path: string): ParsedInstant {
  if (typeof value !== "string") {
    return fail("invalid_date", path, `${path} must be an ISO timestamp with an explicit offset`);
  }
  const match = EXPLICIT_INSTANT.exec(value);
  if (!match) {
    return fail("invalid_date", path, `${path} must be an ISO timestamp with an explicit offset`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, offsetSign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText ?? 0);
  const offsetMinute = Number(offsetMinuteText ?? 0);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    year < 2000 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (zone !== "Z" && (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)))
  ) {
    fail("invalid_date", path, `${path} is not a valid timestamp`);
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    fail("invalid_date", path, `${path} is not a valid timestamp`);
  }
  const unsignedOffset = offsetHour * 60 + offsetMinute;
  return {
    // Preserve the verified local offset. Converting to UTC here would make the
    // stored snapshot fail its own timezone-offset check on the next parse.
    iso: value,
    date: instant,
    offsetMinutes: zone === "Z" ? 0 : offsetSign === "-" ? -unsignedOffset : unsignedOffset,
  };
}

function parseTimezone(value: unknown): string {
  const timezone = requiredText(value, "schedule.timezone", 100);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
  } catch {
    fail("invalid_timezone", "schedule.timezone", "schedule.timezone must be an IANA timezone");
  }
  return timezone;
}

function timezoneOffsetMinutes(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const localAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  const instantAtSecondPrecision = Math.floor(instant.getTime() / 1_000) * 1_000;
  return Math.round((localAsUtc - instantAtSecondPrecision) / 60_000);
}

function assertTimezoneOffset(
  instant: ParsedInstant,
  timezone: string,
  path: string,
): void {
  if (timezoneOffsetMinutes(instant.date, timezone) !== instant.offsetMinutes) {
    fail(
      "timezone_offset_mismatch",
      path,
      `${path} offset does not match schedule.timezone at that instant`,
    );
  }
}

function parseDestinationUrl(value: unknown, path: string): string {
  const raw = requiredText(value, path, 2_048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("invalid_url", path, `${path} must be a valid HTTPS URL`);
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    fail("invalid_url", path, `${path} must be a credential-free HTTPS URL`);
  }
  if (isNonPublicHostname(url.hostname)) {
    fail("unsafe_destination", path, `${path} cannot target a local or private host`);
  }
  return url.toString();
}

function ipv4Parts(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  return numbers.every((part) => part >= 0 && part <= 255) ? numbers : null;
}

function isPrivateIpv4(parts: readonly number[]): boolean {
  const [first = -1, second = -1] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = ipv4Parts(normalized.slice("::ffff:".length));
    return mapped ? isPrivateIpv4(mapped) : false;
  }
  const firstHextet = Number.parseInt(normalized.split(":", 1)[0] ?? "", 16);
  if (!Number.isFinite(firstHextet)) return false;
  return (
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00
  );
}

function isNonPublicHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) {
    return true;
  }
  const ipv4 = ipv4Parts(normalized);
  if (ipv4) return isPrivateIpv4(ipv4);
  if (normalized.includes(":")) return isPrivateIpv6(normalized);
  return !normalized.includes(".");
}

function parseConnection(
  value: unknown,
  platform: PaidPlatform,
  context: PaidSnapshotParseContext,
): PaidAccountIdentity {
  const body = object(value, "connection");
  onlyKeys(body, ["platform", "connectionId", "accountId", "accountName"], "connection");
  const identity: PaidAccountIdentity = {
    platform: enumValue(body.platform, PLATFORM_VALUES, "connection.platform"),
    connectionId: identifier(body.connectionId, "connection.connectionId"),
    accountId: identifier(body.accountId, "connection.accountId"),
    accountName: requiredText(body.accountName, "connection.accountName", 160),
  };
  if (identity.platform !== platform) {
    fail("account_mismatch", "connection.platform", "The connection platform does not match the draft");
  }
  if (context.expectedPlatform && identity.platform !== context.expectedPlatform) {
    fail("account_mismatch", "connection.platform", "The draft does not match the selected platform");
  }
  if (context.expectedConnectionId && identity.connectionId !== context.expectedConnectionId) {
    fail("account_mismatch", "connection.connectionId", "The draft does not match the selected connection");
  }
  if (context.expectedAccountId && identity.accountId !== context.expectedAccountId) {
    fail("account_mismatch", "connection.accountId", "The draft does not match the selected account");
  }
  return identity;
}

function parseCampaign(value: unknown): { name: string; objective: PaidCampaignObjective } {
  const body = object(value, "campaign");
  onlyKeys(body, ["name", "objective"], "campaign");
  return {
    name: requiredText(body.name, "campaign.name", 160),
    objective: enumValue(body.objective, OBJECTIVE_VALUES, "campaign.objective"),
  };
}

function parseBudget(value: unknown): PaidBudgetSnapshot {
  const body = object(value, "budget");
  onlyKeys(body, ["amountMinor", "currency", "cadence"], "budget");
  return {
    amountMinor: safeInteger(body.amountMinor, "budget.amountMinor", 1, MAX_BUDGET_MINOR),
    currency: parseCurrency(body.currency),
    cadence: enumValue(body.cadence, new Set(["daily", "lifetime"]), "budget.cadence"),
  };
}

function parseSchedule(value: unknown): PaidScheduleSnapshot {
  const body = object(value, "schedule");
  onlyKeys(body, ["startsAt", "endsAt", "timezone"], "schedule");
  const timezone = parseTimezone(body.timezone);
  const startsAt = parseInstant(body.startsAt, "schedule.startsAt");
  const endsAt = parseInstant(body.endsAt, "schedule.endsAt");
  assertTimezoneOffset(startsAt, timezone, "schedule.startsAt");
  assertTimezoneOffset(endsAt, timezone, "schedule.endsAt");
  const duration = endsAt.date.getTime() - startsAt.date.getTime();
  if (duration <= 0 || duration > MAX_SCHEDULE_MS) {
    fail(
      "invalid_schedule",
      "schedule.endsAt",
      "schedule.endsAt must be after startsAt and no more than 366 days later",
    );
  }
  return { startsAt: startsAt.iso, endsAt: endsAt.iso, timezone };
}

function parseSearchTargeting(value: unknown, path: string): GoogleSearchTargetingSnapshot {
  const body = object(value, path);
  onlyKeys(body, ["kind", "locations", "languages", "keywords", "negativeKeywords"], path);
  if (body.kind !== "search") {
    fail("invalid_targeting", `${path}.kind`, `${path}.kind must be search`);
  }
  const keywords = list(body.keywords, `${path}.keywords`, 1, 100).map((entry, index) => {
    const keywordPath = `${path}.keywords[${index}]`;
    const keyword = object(entry, keywordPath);
    onlyKeys(keyword, ["text", "matchType"], keywordPath);
    return {
      text: requiredText(keyword.text, `${keywordPath}.text`, 80),
      matchType: enumValue(keyword.matchType, MATCH_TYPE_VALUES, `${keywordPath}.matchType`),
    } satisfies SearchKeywordSnapshot;
  });
  uniqueBy(keywords, (keyword) => `${keyword.matchType}:${keyword.text}`, `${path}.keywords`);
  return {
    kind: "search",
    locations: textList(body.locations, `${path}.locations`, 1, 50, 100),
    languages: textList(body.languages, `${path}.languages`, 1, 20, 40),
    keywords,
    negativeKeywords: textList(body.negativeKeywords, `${path}.negativeKeywords`, 0, 100, 80),
  };
}

function parseSocialTargeting(value: unknown, path: string): SocialTargetingSnapshot {
  const body = object(value, path);
  onlyKeys(
    body,
    ["kind", "locations", "languages", "ageMin", "ageMax", "genders", "interests"],
    path,
  );
  if (body.kind !== "audience") {
    fail("invalid_targeting", `${path}.kind`, `${path}.kind must be audience`);
  }
  const ageMin = safeInteger(body.ageMin, `${path}.ageMin`, 13, 65);
  const ageMax = safeInteger(body.ageMax, `${path}.ageMax`, 13, 65);
  if (ageMax < ageMin) {
    fail("invalid_targeting", `${path}.ageMax`, `${path}.ageMax must be at least ageMin`);
  }
  const genders = list(body.genders, `${path}.genders`, 1, 3).map((gender, index) =>
    enumValue(gender, GENDER_VALUES, `${path}.genders[${index}]`),
  );
  uniqueBy(genders, (gender) => gender, `${path}.genders`);
  if (genders.includes("all") && genders.length !== 1) {
    fail("invalid_targeting", `${path}.genders`, "all cannot be combined with another gender");
  }
  return {
    kind: "audience",
    locations: textList(body.locations, `${path}.locations`, 1, 50, 100),
    languages: textList(body.languages, `${path}.languages`, 1, 20, 40),
    ageMin,
    ageMax,
    genders,
    interests: textList(body.interests, `${path}.interests`, 0, 100, 100),
  };
}

function parseAssetIds(value: unknown, path: string, count: 0 | 1): [] | [string] {
  const items = list(value, path, count, count).map((assetId, index) =>
    identifier(assetId, `${path}[${index}]`),
  );
  return items as [] | [string];
}

function parseGoogleAd(value: unknown, path: string): GoogleResponsiveSearchAdSnapshot {
  const body = object(value, path);
  onlyKeys(
    body,
    ["localId", "name", "format", "assetIds", "headlines", "descriptions", "destinationUrl", "path1", "path2"],
    path,
  );
  if (body.format !== "responsive_search") {
    fail("invalid_ad_format", `${path}.format`, "Google Search drafts require responsive_search ads");
  }
  return {
    localId: identifier(body.localId, `${path}.localId`),
    name: requiredText(body.name, `${path}.name`, 128),
    format: "responsive_search",
    assetIds: parseAssetIds(body.assetIds, `${path}.assetIds`, 0) as [],
    headlines: textList(body.headlines, `${path}.headlines`, 3, 15, 30),
    descriptions: textList(body.descriptions, `${path}.descriptions`, 2, 4, 90),
    destinationUrl: parseDestinationUrl(body.destinationUrl, `${path}.destinationUrl`),
    path1: nullableText(body.path1, `${path}.path1`, 15),
    path2: nullableText(body.path2, `${path}.path2`, 15),
  };
}

function parseMetaAd(value: unknown, path: string): MetaCreativeAdSnapshot {
  const body = object(value, path);
  onlyKeys(
    body,
    ["localId", "name", "format", "assetIds", "primaryText", "headline", "description", "callToAction", "destinationUrl"],
    path,
  );
  if (body.format !== "image" && body.format !== "video") {
    fail("invalid_ad_format", `${path}.format`, "Meta drafts require image or video ads");
  }
  return {
    localId: identifier(body.localId, `${path}.localId`),
    name: requiredText(body.name, `${path}.name`, 128),
    format: body.format,
    assetIds: parseAssetIds(body.assetIds, `${path}.assetIds`, 1) as [string],
    primaryText: requiredText(body.primaryText, `${path}.primaryText`, 2_200),
    headline: requiredText(body.headline, `${path}.headline`, 255),
    description: nullableText(body.description, `${path}.description`, 500),
    callToAction: enumValue(body.callToAction, CTA_VALUES, `${path}.callToAction`),
    destinationUrl: parseDestinationUrl(body.destinationUrl, `${path}.destinationUrl`),
  };
}

function parseTikTokAd(value: unknown, path: string): TikTokVideoAdSnapshot {
  const body = object(value, path);
  onlyKeys(
    body,
    ["localId", "name", "format", "assetIds", "primaryText", "headline", "callToAction", "destinationUrl"],
    path,
  );
  if (body.format !== "video") {
    fail("invalid_ad_format", `${path}.format`, "TikTok drafts require video ads");
  }
  return {
    localId: identifier(body.localId, `${path}.localId`),
    name: requiredText(body.name, `${path}.name`, 128),
    format: "video",
    assetIds: parseAssetIds(body.assetIds, `${path}.assetIds`, 1) as [string],
    primaryText: requiredText(body.primaryText, `${path}.primaryText`, 2_200),
    headline: requiredText(body.headline, `${path}.headline`, 255),
    callToAction: enumValue(body.callToAction, CTA_VALUES, `${path}.callToAction`),
    destinationUrl: parseDestinationUrl(body.destinationUrl, `${path}.destinationUrl`),
  };
}

function parseGoogleAdGroups(value: unknown): GoogleSearchAdGroupSnapshot[] {
  const groups = list(value, "adGroups", 1, 20).map((entry, groupIndex) => {
    const path = `adGroups[${groupIndex}]`;
    const body = object(entry, path);
    onlyKeys(body, ["localId", "name", "targeting", "ads"], path);
    const ads = list(body.ads, `${path}.ads`, 1, 20).map((ad, adIndex) =>
      parseGoogleAd(ad, `${path}.ads[${adIndex}]`),
    );
    uniqueBy(ads, (ad) => ad.localId, `${path}.ads`);
    return {
      localId: identifier(body.localId, `${path}.localId`),
      name: requiredText(body.name, `${path}.name`, 128),
      targeting: parseSearchTargeting(body.targeting, `${path}.targeting`),
      ads,
    };
  });
  uniqueBy(groups, (group) => group.localId, "adGroups");
  return groups;
}

function parseMetaAdGroups(value: unknown): MetaAdGroupSnapshot[] {
  const groups = list(value, "adGroups", 1, 20).map((entry, groupIndex) => {
    const path = `adGroups[${groupIndex}]`;
    const body = object(entry, path);
    onlyKeys(body, ["localId", "name", "targeting", "ads"], path);
    const ads = list(body.ads, `${path}.ads`, 1, 20).map((ad, adIndex) =>
      parseMetaAd(ad, `${path}.ads[${adIndex}]`),
    );
    uniqueBy(ads, (ad) => ad.localId, `${path}.ads`);
    return {
      localId: identifier(body.localId, `${path}.localId`),
      name: requiredText(body.name, `${path}.name`, 128),
      targeting: parseSocialTargeting(body.targeting, `${path}.targeting`),
      ads,
    };
  });
  uniqueBy(groups, (group) => group.localId, "adGroups");
  return groups;
}

function parseTikTokAdGroups(value: unknown): TikTokAdGroupSnapshot[] {
  const groups = list(value, "adGroups", 1, 20).map((entry, groupIndex) => {
    const path = `adGroups[${groupIndex}]`;
    const body = object(entry, path);
    onlyKeys(body, ["localId", "name", "targeting", "ads"], path);
    const ads = list(body.ads, `${path}.ads`, 1, 20).map((ad, adIndex) =>
      parseTikTokAd(ad, `${path}.ads[${adIndex}]`),
    );
    uniqueBy(ads, (ad) => ad.localId, `${path}.ads`);
    return {
      localId: identifier(body.localId, `${path}.localId`),
      name: requiredText(body.name, `${path}.name`, 128),
      targeting: parseSocialTargeting(body.targeting, `${path}.targeting`),
      ads,
    };
  });
  uniqueBy(groups, (group) => group.localId, "adGroups");
  return groups;
}

function assertTemplatePairing(
  platform: PaidPlatform,
  template: PaidLaunchTemplate,
  objective: PaidCampaignObjective,
): void {
  const valid =
    (platform === "google_ads" && template === "google_search_rsa" && objective === "traffic") ||
    (platform === "meta_ads" && template === "meta_traffic" && objective === "traffic") ||
    (platform === "meta_ads" && template === "meta_lead" && objective === "leads") ||
    (platform === "tiktok_ads" && template === "tiktok_traffic" && objective === "traffic") ||
    (platform === "tiktok_ads" && template === "tiktok_conversion" && objective === "conversions");
  if (!valid) {
    fail(
      "unsupported_template",
      "template",
      "The platform, template, and campaign objective are not a supported launch combination",
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function parsePaidCampaignSnapshotV1(
  value: unknown,
  context: PaidSnapshotParseContext = {},
): PaidCampaignSnapshotV1 {
  const body = object(value, "snapshot");
  onlyKeys(
    body,
    [
      "schemaVersion",
      "source",
      "platform",
      "template",
      "connection",
      "campaign",
      "budget",
      "schedule",
      "adGroups",
      "assumptions",
    ],
    "snapshot",
  );
  if (body.schemaVersion !== 1) {
    fail("invalid_schema_version", "schemaVersion", "schemaVersion must be 1");
  }
  const source = enumValue(body.source, SOURCE_VALUES, "source");
  const platform = enumValue(body.platform, PLATFORM_VALUES, "platform");
  const template = enumValue(body.template, TEMPLATE_VALUES, "template");
  const campaign = parseCampaign(body.campaign);
  assertTemplatePairing(platform, template, campaign.objective);
  const common = {
    schemaVersion: 1 as const,
    source,
    platform,
    template,
    connection: parseConnection(body.connection, platform, context),
    campaign,
    budget: parseBudget(body.budget),
    schedule: parseSchedule(body.schedule),
    assumptions: textList(body.assumptions, "assumptions", 0, 12, 500),
  };

  if (platform === "google_ads") {
    return deepFreeze({ ...common, platform, template: "google_search_rsa", adGroups: parseGoogleAdGroups(body.adGroups) }) as PaidCampaignSnapshotV1;
  }
  if (platform === "meta_ads") {
    return deepFreeze({ ...common, platform, template, adGroups: parseMetaAdGroups(body.adGroups) }) as PaidCampaignSnapshotV1;
  }
  return deepFreeze({ ...common, platform, template, adGroups: parseTikTokAdGroups(body.adGroups) }) as PaidCampaignSnapshotV1;
}
