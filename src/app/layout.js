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
      { url: "/favicon.ico" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" }
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
    ]
  },
  manifest: "/site.webmanifest"
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
