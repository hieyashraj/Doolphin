const AVATAR_NAMES = [
  "Andrew", "Choi", "Dianna", "Duma", "Eduardo", "Elizabeth", "Garret", "Hannah",
  "Jameson", "Jim", "John", "Jordon", "Josh", "Li", "Mathilda", "Matty", "Meena",
  "Milly", "Naomi", "Shyla", "Sydney", "Tracey"
];

export const AVATAR_REGISTRY = Object.fromEntries(AVATAR_NAMES.map((name) => [
  name.toLowerCase(),
  { id: name.toLowerCase(), name, url: `/avatars/${name} E1.png` }
]));

export function resolvePlatformAvatar(assetId) {
  return AVATAR_REGISTRY[String(assetId || "").toLowerCase()] || null;
}
