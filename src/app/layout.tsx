import type { Metadata } from "next";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/components/language-provider";
import "./globals.css";
import "./product.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ??
      "https://floral-ai-git-main-iskander11.vercel.app",
  ),
  title: "FloralAI | Thoughtful conversations, beautifully handled",
  description:
    "A thoughtful AI teammate for flower shops and small businesses. Welcome customers, guide orders and never miss a conversation.",
  openGraph: {
    title: "FloralAI | A thoughtful AI teammate for your business",
    description:
      "Welcome every customer, guide flower orders and keep conversations moving.",
    siteName: "FloralAI",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FloralAI | A thoughtful AI teammate for your business",
    description:
      "Answer questions, capture leads and book appointments around the clock.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
