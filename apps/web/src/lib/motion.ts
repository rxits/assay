// Motion tokens (R1) — the single source for spring + timing character, mirrored
// by --ease-spring / --dur-* in index.css so CSS-driven and motion/react-driven
// transitions feel like one system. Grounded in ecc:motion-foundations
// (transform/opacity only, springs from a named map, stagger ≤ 0.1s) and tuned
// for the Emil-Kowalski "interruptible & calm" feel. This is a Vite SPA, so the
// SSR mount-guard dance the skill prescribes is unnecessary; useReducedMotion()
// from motion/react is the accessibility gate at every call site.
import { useReducedMotion, type Variants } from "motion/react";
import { usePreferences } from "@/lib/preferences";

/**
 * The single motion gate for the app: the OS setting OR the in-app override from Settings.
 * Every call site uses this instead of motion/react's useReducedMotion so a user who can't
 * change their OS preference (shared machine, kiosk) still gets a calm interface.
 */
export function useReduceMotion(): boolean {
  const system = useReducedMotion() ?? false;
  const { motion } = usePreferences();
  return system || motion === "reduced";
}

export const springs = {
  /** Default UI — nav active indicator, chips, small snaps. */
  snappy: { type: "spring", stiffness: 380, damping: 32 } as const,
  /** Cards / panels landing softly — the staggered dashboard entrance. */
  gentle: { type: "spring", stiffness: 160, damping: 22 } as const,
  /** Popovers / modals — quick and settled, minimal overshoot. */
  instant: { type: "spring", stiffness: 520, damping: 36 } as const,
} as const;

export const motionTokens = {
  duration: { fast: 0.16, normal: 0.28, slow: 0.44 },
  distance: { sm: 6, md: 12, lg: 20 },
  // Emil-Kowalski smooth ease — enter/move; keep exits shorter + quieter.
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
} as const;

/** Staggered container for a grid/list of cards. Stagger stays ≤ 0.1s (skill rule). */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};

/** A single card/tile: fade + small rise, settled by a gentle spring. */
export const fadeUpItem: Variants = {
  hidden: { opacity: 0, y: motionTokens.distance.md },
  show: { opacity: 1, y: 0, transition: springs.gentle },
};
