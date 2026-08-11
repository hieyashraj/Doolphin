import { LEGAL_DOCUMENTS } from "@/lib/legal/documents";
export default function Terms(){const d=LEGAL_DOCUMENTS.terms;return <main className="mx-auto max-w-3xl whitespace-pre-line px-6 py-16"><h1 className="mb-8 font-serif text-5xl font-bold">{d.title}</h1>{d.content}</main>}
