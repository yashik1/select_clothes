import type { MetadataRoute } from "next";

/**
 * What makes this installable.
 *
 * The phone layout was fixed but the app was still a browser tab, and the part
 * of this app that costs the most effort — photographing a wardrobe, one
 * garment at a time — is exactly the part a tab is worst at. Installed, it
 * launches from the home screen, keeps its own history, and loses the address
 * bar that was eating 15% of an already small screen.
 *
 * `display: standalone` rather than `fullscreen`: the status bar has the clock
 * and the battery on it, and an app people open for thirty seconds while
 * getting dressed should not take those away.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FitCheck — will this actually work?",
    short_name: "FitCheck",
    description:
      "Your wardrobe and your measurements, scored together. Explainable outfit advice grounded in centimetres, not vibes.",
    start_url: "/",
    // Scoped to the whole origin so a shared outfit link opened from a message
    // still lands inside the installed app rather than bouncing to the browser.
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf8f5",
    theme_color: "#faf8f5",
    categories: ["lifestyle", "shopping", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /*
       * Separate entry, not `purpose: "any maskable"`. A single icon declared as
       * both gets masked on Android *and* used unmasked elsewhere, so it must be
       * drawn for the worst case — which leaves it visibly small everywhere
       * else. Two files, each drawn for its own job.
       */
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Add an item", short_name: "Add", url: "/wardrobe/new" },
      { name: "Today's outfit", short_name: "Today", url: "/" },
      { name: "Calendar", short_name: "Calendar", url: "/calendar" },
    ],
  };
}
