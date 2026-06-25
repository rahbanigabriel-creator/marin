import type { MetadataRoute } from "next";

/** Sitemap — the public, indexable pages. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.marpin.ai";
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/data-deletion`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
