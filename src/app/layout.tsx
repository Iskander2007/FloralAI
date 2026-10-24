import type { Metadata } from "next";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/components/language-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { themeInitScript } from "@/lib/theme";
import { defaultLocale, translate } from "@/lib/i18n";
import "./globals.css";
import "./product.css";
import "./themes.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ??
      "https://floral-ai-git-main-iskander11.vercel.app",
  ),
  title: translate(defaultLocale, "FloralAI | Thoughtful conversations, beautifully handled"),
  description:
    "Умный помощник для цветочных магазинов и малого бизнеса. Отвечайте клиентам, принимайте заявки и помогайте с заказами круглосуточно.",
  openGraph: {
    title: "FloralAI | Умный помощник для вашего бизнеса",
    description:
      "Помогайте каждому клиенту, подбирайте букеты и принимайте заказы.",
    siteName: "FloralAI",
    locale: "ru_RU",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FloralAI | Умный помощник для вашего бизнеса",
    description:
      "Отвечайте на вопросы, принимайте заявки и записывайте клиентов круглосуточно.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      suppressHydrationWarning
      data-theme="light"
      lang={defaultLocale}
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} h-full antialiased`}
    >
      <head>
        <script id="floralai-theme" dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider><LanguageProvider>{children}</LanguageProvider></ThemeProvider>
      </body>
    </html>
  );
}
