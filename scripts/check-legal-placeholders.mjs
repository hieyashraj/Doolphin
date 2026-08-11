import { hasUnresolvedLegalPlaceholders } from "../src/lib/legal/documents.js";
if (hasUnresolvedLegalPlaceholders()) { console.error("Production legal documents still contain unresolved placeholders or missing approved copy."); process.exit(1); }
