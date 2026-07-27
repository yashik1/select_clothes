import type { BodyMeasurements } from "../types";

export interface MeasurementField {
  key: keyof BodyMeasurements;
  label: string;
  how: string;
  /** Core fields do the most work in the engines and are asked for first. */
  core?: boolean;
}

export interface MeasurementGroup {
  title: string;
  blurb: string;
  fields: MeasurementField[];
}

/**
 * The onboarding contract: ask for the four that matter, explain exactly how to
 * take each one, and let everything else be optional. Wardrobe apps that demand
 * fifteen measurements up front get abandoned at measurement three.
 */
export const MEASUREMENT_GROUPS: MeasurementGroup[] = [
  {
    title: "The four that matter",
    blurb:
      "These alone let the fit engine judge most garments. Measure over light clothing, tape snug but not pulled tight.",
    fields: [
      { key: "height", label: "Height", how: "Barefoot, against a wall.", core: true },
      { key: "chest", label: "Chest / bust", how: "Around the fullest point, tape level all the way round.", core: true },
      { key: "waistNatural", label: "Natural waist", how: "The narrowest point — bend sideways and the crease is it.", core: true },
      { key: "hip", label: "Hip", how: "Around the fullest part of your seat, feet together.", core: true },
    ],
  },
  {
    title: "Torso",
    blurb: "Unlocks shoulder fit, shirt length and where a hem will actually land on you.",
    fields: [
      { key: "shoulderWidth", label: "Shoulder width", how: "Across your back, bone to bone." },
      { key: "neck", label: "Neck", how: "Around the base, one finger under the tape." },
      { key: "torsoLength", label: "Torso length", how: "Base of neck straight down to your natural waist, front." },
      { key: "backLength", label: "Back length", how: "Bone at the base of your neck to your natural waist." },
      { key: "underbust", label: "Underbust", how: "Directly under the bust, tape level." },
      { key: "highHip", label: "High hip", how: "About 8cm below your natural waist." },
    ],
  },
  {
    title: "Arms",
    blurb: "Sleeve length is the most commonly wrong measurement on a jacket, and the most visible.",
    fields: [
      { key: "armLength", label: "Arm length", how: "Shoulder point to wrist bone, arm slightly bent." },
      { key: "sleeveFromCenterBack", label: "Sleeve (centre back)", how: "Neck bone, across the shoulder, down to the wrist." },
      { key: "bicep", label: "Bicep", how: "Around the fullest part, arm relaxed." },
      { key: "wrist", label: "Wrist", how: "Around the wrist bone." },
    ],
  },
  {
    title: "Legs",
    blurb: "Inseam plus height is what tells us your leg-to-torso proportion — the single most useful ratio for styling.",
    fields: [
      { key: "inseam", label: "Inseam", how: "Crotch to the floor, barefoot. Easiest measured on trousers that fit." },
      { key: "outseam", label: "Outseam", how: "Waistband to hem down the outside of the leg." },
      { key: "riseFront", label: "Front rise", how: "Crotch seam up to the top of the waistband, front." },
      { key: "thigh", label: "Thigh", how: "Around the fullest part of one thigh." },
      { key: "calf", label: "Calf", how: "Around the fullest part of one calf." },
      { key: "waistWorn", label: "Waist where you wear it", how: "Where your waistbands actually sit — often lower than your natural waist." },
    ],
  },
  {
    title: "Other",
    blurb: "Optional, used for shoe sizing and for tracking change over time.",
    fields: [
      { key: "weight", label: "Weight", how: "Optional. Only used if you want the change-over-time chart." },
      { key: "footLength", label: "Foot length", how: "Heel to longest toe, standing on paper." },
    ],
  },
];

export const CORE_KEYS = MEASUREMENT_GROUPS.flatMap((g) => g.fields.filter((f) => f.core).map((f) => f.key));
