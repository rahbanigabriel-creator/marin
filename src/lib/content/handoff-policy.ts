import type { OrganicPlatformId } from "@/lib/content/destinations";
import { isOrganicPlatform } from "@/lib/content/destinations";
import { ContentValidationError } from "@/lib/content/errors";

const OPEN_PLATFORM_URLS = {
  youtube: "https://studio.youtube.com/",
  instagram: "https://www.instagram.com/create/select/",
  facebook: "https://www.facebook.com/",
  tiktok: "https://www.tiktok.com/tiktokstudio/upload",
  snapchat: "https://profile.snapchat.com/",
  reddit: "https://www.reddit.com/submit",
  pinterest: "https://www.pinterest.com/pin-creation-tool/",
} as const satisfies Record<OrganicPlatformId, string>;

const HOSTS: Record<OrganicPlatformId, readonly string[]> = {
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
  instagram: ["instagram.com", "www.instagram.com"],
  facebook: ["facebook.com", "www.facebook.com"],
  tiktok: ["tiktok.com", "www.tiktok.com"],
  snapchat: ["snapchat.com", "www.snapchat.com"],
  reddit: ["reddit.com", "www.reddit.com", "redd.it"],
  pinterest: ["pinterest.com", "www.pinterest.com"],
};

function invalidPermalink(): never {
  throw new ContentValidationError(
    "invalid_permalink",
    "Enter a direct HTTPS link to the completed post on this platform",
  );
}

function exactQuery(url: URL, allowed: readonly string[]): boolean {
  return [...url.searchParams.keys()].every((key) => allowed.includes(key));
}

function cleanPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function parseStrictHttps(value: string): URL {
  const authority = /^https:\/\/([^/?#]+)/i.exec(value.trim())?.[1] ?? "";
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return invalidPermalink();
  }
  if (
    url.protocol !== "https:" ||
    !authority ||
    authority.includes(":") ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    return invalidPermalink();
  }
  url.pathname = cleanPath(url.pathname);
  return url;
}

function requireHost(platform: OrganicPlatformId, hostname: string): void {
  if (!HOSTS[platform].includes(hostname.toLowerCase())) invalidPermalink();
}

function canonicalHost(platform: OrganicPlatformId, hostname: string): string {
  if (hostname === "youtu.be" || hostname === "redd.it") return hostname;
  return `www.${platform}.com`;
}

export function openOrganicPlatformUrl(platform: string): string {
  if (!isOrganicPlatform(platform)) {
    throw new ContentValidationError("unsupported_platform", "Assisted handoff is not available here");
  }
  return OPEN_PLATFORM_URLS[platform];
}

export function canonicalOrganicPermalink(platform: string, value: string): string {
  if (!isOrganicPlatform(platform)) {
    throw new ContentValidationError("unsupported_platform", "Assisted handoff is not available here");
  }
  const url = parseStrictHttps(value);
  const host = url.hostname.toLowerCase();
  requireHost(platform, host);
  const segments = url.pathname.split("/").filter(Boolean);
  const noQuery = url.searchParams.size === 0;
  let valid = false;

  if (platform === "youtube") {
    const videoId = /^[A-Za-z0-9_-]{11}$/;
    if (host === "youtu.be") valid = segments.length === 1 && videoId.test(segments[0] ?? "") && noQuery;
    else if (url.pathname === "/watch") {
      valid = exactQuery(url, ["v"]) && url.searchParams.size === 1 && videoId.test(url.searchParams.get("v") ?? "");
    } else {
      valid = segments.length === 2 && ["shorts", "live"].includes(segments[0] ?? "") && videoId.test(segments[1] ?? "") && noQuery;
    }
  } else if (platform === "instagram") {
    valid = noQuery && (
      (segments.length === 2 && ["p", "reel", "tv"].includes(segments[0] ?? "") && /^[A-Za-z0-9_-]+$/.test(segments[1] ?? "")) ||
      (segments.length === 3 && segments[0] === "stories" && /^[A-Za-z0-9._]+$/.test(segments[1] ?? "") && /^\d+$/.test(segments[2] ?? ""))
    );
  } else if (platform === "facebook") {
    valid = (
      noQuery && (
        (segments.length === 3 && ["posts", "videos"].includes(segments[1] ?? "") && Boolean(segments[0]) && /^\d+$/.test(segments[2] ?? "")) ||
        (segments.length === 2 && segments[0] === "reel" && /^\d+$/.test(segments[1] ?? ""))
      )
    ) || (
      url.pathname === "/permalink.php" &&
      exactQuery(url, ["story_fbid", "id"]) &&
      url.searchParams.size === 2 &&
      /^\d+$/.test(url.searchParams.get("story_fbid") ?? "") &&
      /^\d+$/.test(url.searchParams.get("id") ?? "")
    );
  } else if (platform === "tiktok") {
    valid = noQuery && segments.length === 3 && /^@[A-Za-z0-9._]+$/.test(segments[0] ?? "") && segments[1] === "video" && /^\d+$/.test(segments[2] ?? "");
  } else if (platform === "snapchat") {
    valid = noQuery && segments.length === 2 && ["spotlight", "p"].includes(segments[0] ?? "") && /^[A-Za-z0-9_-]+$/.test(segments[1] ?? "");
  } else if (platform === "reddit") {
    valid = noQuery && (
      (host === "redd.it" && segments.length === 1 && /^[a-z0-9]+$/i.test(segments[0] ?? "")) ||
      (host !== "redd.it" && segments.length >= 4 && segments.length <= 5 && segments[0] === "r" && /^[A-Za-z0-9_]+$/.test(segments[1] ?? "") && segments[2] === "comments" && /^[a-z0-9]+$/i.test(segments[3] ?? "") && (segments.length === 4 || /^[A-Za-z0-9_-]+$/.test(segments[4] ?? "")))
    );
  } else if (platform === "pinterest") {
    valid = noQuery && segments.length === 2 && segments[0] === "pin" && /^\d+$/.test(segments[1] ?? "");
  }

  if (!valid) invalidPermalink();
  url.hostname = canonicalHost(platform, host);
  url.searchParams.sort();
  return url.toString();
}
