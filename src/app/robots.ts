import type { MetadataRoute } from "next";

/**
 * robots.txt — allow crawling of the public marketing surface, keep the
 * authenticated app + API out of the index.
 */
export default function robots(): MetadataRoute.Robots {
  const base = "https://www.marpin.ai";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/api/", "/sign-in", "/sign-up"],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
