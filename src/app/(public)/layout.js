import Link from "next/link";
export default function PublicLayout({ children }) {
  return <div className="min-h-screen bg-[#FAF8ED] text-[#111111]"><header className="mx-auto flex max-w-6xl items-center justify-between p-6"><Link className="font-serif text-2xl font-bold" href="/">Doolphin</Link><nav className="flex gap-4 text-sm font-semibold"><Link href="/pricing">Pricing</Link><Link href="/sign-in">Sign in</Link></nav></header>{children}<footer className="mx-auto flex max-w-6xl gap-4 p-6 text-xs"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/refund-policy">Refund Policy</Link></footer></div>;
}
