import type { MetadataRoute } from "next";

const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://floral-ai-git-main-iskander11.vercel.app";

export default function robots(): MetadataRoute.Robots {
    return {
        rules: { userAgent: "*", allow: "/", disallow: ["/dashboard", "/onboarding", "/api/"] },
        sitemap: new URL("/sitemap.xml", baseUrl).toString(),
    };
}
