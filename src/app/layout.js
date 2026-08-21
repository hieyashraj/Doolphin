import "./globals.css";

export const metadata = {
  title: "Doolphin — Enterprise AI UGC Platform",
  description:
    "Generate high-performing AI UGC video ads with realistic avatars, scripts, and voiceovers — powered by Veo 3.1, Seedance, Grok Video, and more.",
  keywords: [
    "AI UGC",
    "UGC ads",
    "AI avatars",
    "AI video ads",
    "Arcads alternative",
    "MakeUGC alternative",
    "AI video generator",
    "text to video",
    "image to video",
  ],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" }
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
    ]
  },
  manifest: "/site.webmanifest",
  metadataBase: new URL("https://doolphin.vercel.app"),
  themeColor: "#0E0F15",
  openGraph: {
    title: "Doolphin — AI Video Generator, Studio-Grade Quality",
    description: "AI video for ideas that deserve to move. Every studio, every model, on every plan.",
    url: "https://doolphin.vercel.app",
    siteName: "Doolphin",
    images: [{ url: "/doolphin-og-1200x630.jpg", width: 1200, height: 630, alt: "Doolphin" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Doolphin — AI Video Generator",
    description: "AI video for ideas that deserve to move.",
    images: ["/doolphin-og-1200x630.jpg"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full w-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans min-h-full antialiased text-[#111111] bg-[#FAF8ED] scrollbar-subtle">{children}</body>
    </html>
  );
}
