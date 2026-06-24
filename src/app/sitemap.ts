import type { MetadataRoute } from "next";

/** Sitemap — the public, indexable pages. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.marpin.ai";
  return [
    {
      url: base,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
