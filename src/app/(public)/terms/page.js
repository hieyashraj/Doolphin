import LegalDocument from "@/components/LegalDocument";
import { LEGAL_DOCUMENTS } from "@/lib/legal/documents";
// landing.css also re-enables page scrolling, which globals.css disables for the
// app shell. Without it a long legal document is clipped and unscrollable.
import "../landing.css";
import "../legal.css";

export const metadata = { title: LEGAL_DOCUMENTS.terms.title };

export default function Terms() {
  return <LegalDocument documentKey="terms" document={LEGAL_DOCUMENTS.terms} />;
}
