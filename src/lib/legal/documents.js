import crypto from "crypto";
import { TERMS_CONTENT } from "./terms.js";
import { PRIVACY_CONTENT } from "./privacy.js";
import { REFUND_CONTENT } from "./refund.js";

/**
 * Guard against unapproved legal copy reaching production.
 *
 * scripts/check-legal-placeholders.mjs exits non-zero while any document still
 * matches this pattern, which is what previously — and correctly — blocked
 * production billing: the Refund Policy was the literal string
 * PENDING_APPROVED_LEGAL_COPY.
 *
 * All three documents are now approved copy for Doolphin Pvt Ltd. Keep the guard.
 * If a document is ever revised back to a draft, restore the placeholder rather
 * than shipping half-written terms, and bump the version (see below).
 */
export const LEGAL_PLACEHOLDER = /\[(?:Effective Date|Last Updated Date|Full Legal Entity Name|Legal Entity Name|Registered Address|Support Email|Privacy Email|Billing Email|Grievance Email|Full Name)\]|PENDING_APPROVED_LEGAL_COPY/;

/**
 * `version` is the consent identifier recorded against a user in LegalConsent
 * (as `legal_terms_v1` / `legal_privacy_v1`, see src/lib/auth/verification-flow.js).
 *
 * These remain v1 because this is the FIRST approved text — the previous v1 was
 * explicitly marked as unapproved draft/placeholder copy that the launch guard
 * refused to ship, so no user has consented to a different approved version.
 * Any future material revision MUST increment the version and update the consent
 * list, otherwise existing consent records would silently appear to cover terms
 * the user never saw.
 */
export const LEGAL_DOCUMENTS = {
  terms: { title: "Doolphin Terms of Service", version: "v1", content: TERMS_CONTENT },
  privacy: { title: "Doolphin Privacy Policy", version: "v1", content: PRIVACY_CONTENT },
  refund: { title: "Doolphin Refund and Cancellation Policy", version: "v1", content: REFUND_CONTENT },
};

export const legalHash = (key) => crypto.createHash("sha256").update(LEGAL_DOCUMENTS[key].content).digest("hex");
export const hasUnresolvedLegalPlaceholders = () => Object.values(LEGAL_DOCUMENTS).some((doc) => LEGAL_PLACEHOLDER.test(doc.content));
