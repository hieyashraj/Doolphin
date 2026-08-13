import { redirect } from "next/navigation";

// My Images was folded into My Library. Keep old bookmarks and history links
// working without rendering a second, divergent generated-media surface.
export default function LegacyMyImagesPage() {
  redirect("/app?tab=library");
}
