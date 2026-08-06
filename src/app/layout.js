import "./globals.css";
import { Providers } from "./providers";
import Navbar from "../components/Navbar";

export const metadata = {
  title: "Doolphin — Enterprise AI UGC Platform",
  description:
    "Generate high-performing AI UGC video ads with realistic actors, scripts, and voiceovers — powered by Veo 3.1, Seedance, Grok Video, and more.",
  keywords: [
    "AI UGC",
    "UGC ads",
    "AI actors",
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
    <html lang="en" data-theme="dark" className="h-full w-full dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans h-full w-full flex antialiased text-white overflow-hidden">
        <Providers>
          <div className="liquid-canvas flex h-screen w-screen overflow-hidden text-white">
            <Navbar />
            <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative z-10 p-4 md:p-6 pl-0">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
