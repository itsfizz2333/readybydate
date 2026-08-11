import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "ReadyByDate.com | Production Timeline Calculator";
  const description =
    "Build production timelines, calculate shipping dates from any starting date, and compare dates supplied by customers.";

  return {
    title,
    description,
    applicationName: "ReadyByDate.com",
    icons: {
      icon: [
        {
          url: `${origin}/readybydate-icon-v2.png`,
          type: "image/png",
        },
      ],
      apple: `${origin}/readybydate-icon-v2.png`,
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: `${origin}/readybydate-brand-v1.png`,
          width: 1536,
          height: 1024,
          alt: "ReadyByDate.com production timeline calculator",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/readybydate-brand-v1.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
