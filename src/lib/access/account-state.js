export function isActivatedUser(appUser) {
  return appUser?.activationStatus === "ACTIVATED";
}

export function postSignInDestination(accountResponse) {
  return accountResponse?.ok ? "/app" : "/pricing";
}

export function safeAccountState({ authUser, appUser, creditAccount }) {
  return {
    name: appUser.name || authUser.email?.split("@")[0] || "Doolphin Creator",
    email: authUser.email || "",
    credits: creditAccount?.availableCredits || 0,
  };
}
