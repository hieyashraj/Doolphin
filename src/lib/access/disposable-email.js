// Curated set of well-known disposable / temporary email providers.
//
// This is the IN-APP guarantee: it runs in the signup route with instant,
// friendly feedback and no database dependency, so baseline protection holds
// even if the Supabase "Before User Created" hook or the BlockedEmailDomain
// table is not configured. Those DB-side layers (see the doolphin_before_user_
// created function) extend this and can be grown by admins without a deploy —
// scripts/seed-blocked-email-domains.mjs seeds the table from this same list.
//
// It is intentionally NOT exhaustive (thousands of throwaway domains exist).
// It blocks the common ones a spammer reaches for first; the goal is to keep
// the signup funnel and credit grants clean, not to win an arms race.
export const DISPOSABLE_EMAIL_DOMAINS = Object.freeze(new Set([
  // sentinel used by the integration/hook tests
  "tempmail.local",
  // mailinator family
  "mailinator.com", "mailinator.net", "mailinator2.com",
  // guerrillamail family
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz",
  "guerrillamail.info", "guerrillamailblock.com", "sharklasers.com", "grr.la", "spam4.me",
  // 10minute / temp / trash mail
  "10minutemail.com", "10minutemail.net", "20minutemail.com", "tempmail.com", "temp-mail.org",
  "tempmail.net", "tempmail.io", "tempmailo.com", "tempail.com", "tempr.email", "temporary-mail.net",
  "throwawaymail.com", "throwawaymail.net", "trashmail.com", "trashmail.net", "trashmail.de",
  "trash-mail.com", "wegwerfmail.de", "wegwerfmail.net", "wegwerfmail.org",
  // yopmail
  "yopmail.com", "yopmail.net", "yopmail.fr", "cool.fr.nf", "jetable.fr.nf", "courriel.fr.nf",
  "nospam.ze.tc", "moncourrier.fr.nf", "monemail.fr.nf", "monmail.fr.nf",
  // nada / getnada
  "getnada.com", "nada.email", "nada.ltd",
  // maildrop / mailcatch / mailnesia / dispostable
  "maildrop.cc", "mailcatch.com", "mailnesia.com", "dispostable.com", "mailsac.com", "mailhog.local",
  // moakt / mohmal / fakeinbox / mintemail / mytemp
  "moakt.com", "moakt.cc", "mohmal.com", "fakeinbox.com", "mintemail.com", "mytemp.email",
  // burner / discard / spambog / meltmail / mailnull / anonbox
  "burnermail.io", "discard.email", "discardmail.com", "discardmail.de", "spambog.com",
  "meltmail.com", "mailnull.com", "anonbox.net", "spamex.com", "incognitomail.com",
  // de / eu throwaways
  "einrot.com", "byom.de", "mailde.de", "mailde.info", "spam.la",
  // misc common throwaways
  "emailondeck.com", "emailfake.com", "email-fake.com", "fakemailgenerator.com",
  "mailforspam.com", "vomoto.com", "spambox.us", "mailtothis.com", "e4ward.com",
  "tmail.ws", "tmpmail.org", "tmpmail.net", "tmpeml.com", "33mail.com",
  "tempmailaddress.com", "minuteinbox.com", "mailpoof.com", "inboxkitten.com",
  "harakirimail.com", "luxusmail.org", "gettempmail.com", "mailexpire.com",
  "maileater.com", "mailimate.com", "mailismagic.com", "spamgourmet.com",
  "mvrht.net", "mailsucker.net", "mailtemp.net", "temp-inbox.com", "tempinbox.com",
  "1secmail.com", "1secmail.net", "1secmail.org", "dropmail.me", "10mail.org",
  "fakemail.net", "mailboxy.fun", "mailpwr.com", "muellmail.com", "spam.care",
]));

export function emailDomainOf(email) {
  const at = String(email || "").trim().toLowerCase().split("@");
  return at.length === 2 ? at[1] : "";
}

/**
 * True when the email's domain — or any parent domain — is a known disposable
 * provider, so `foo@inbox.mailinator.com` is caught as well as `foo@mailinator.com`.
 */
export function isDisposableEmailDomain(email) {
  const domain = emailDomainOf(email);
  if (!domain) return false;
  const labels = domain.split(".");
  // Check the full domain and each parent suffix down to (but not including) the
  // bare TLD, so a whole TLD is never blocked by accident.
  for (let i = 0; i <= labels.length - 2; i += 1) {
    if (DISPOSABLE_EMAIL_DOMAINS.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
