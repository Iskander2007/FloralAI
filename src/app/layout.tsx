import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import "./product.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://bizai.example"),
  title: "AI Assistant for Small Businesses | BizAI",
  description:
    "Automate customer conversations, capture leads and support your business 24/7 with an AI assistant.",
  openGraph: {
    title: "BizAI | Your AI teammate for every customer",
    description:
      "Answer questions, capture leads and book appointments around the clock.",
    siteName: "BizAI",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BizAI | Your AI teammate for every customer",
    description:
      "Answer questions, capture leads and book appointments around the clock.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
