import { Jost, Libre_Caslon_Text } from "next/font/google";

/**
 * Wealthsimple pairs Caslon with Futura: a warm transitional serif for
 * anything that should feel considered, and a geometric sans for everything
 * that should get out of the way. Neither is licensable here, so these are the
 * closest open revivals — Libre Caslon Text is drawn from the same source, and
 * Jost is a Futura revival down to the single-storey `a`.
 *
 * next/font downloads them at build time and serves them from our own origin,
 * so there is no request to a third party at runtime and nothing to block.
 */
export const sans = Jost({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const serif = Libre_Caslon_Text({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-serif",
});
