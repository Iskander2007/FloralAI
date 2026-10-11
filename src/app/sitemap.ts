import type { MetadataRoute } from "next";

const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://floral-ai-git-main-iskander11.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
    return ["/", "/signup", "/login"].map((path) => ({
        url: new URL(path, baseUrl).toString(),
        lastModified: new Date(),
        changeFrequency: path === "/" ? "weekly" : "monthly",
        priority: path === "/" ? 1 : 0.4,
    }));
}
