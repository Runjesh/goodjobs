import type { Variants } from 'framer-motion';

/** Match CSS `--ease-*` tokens; use in Framer `ease` arrays only. */
export const EASE_STANDARD = [0.4, 0, 0.2, 1] as const;
export const EASE_DECELERATE = [0, 0, 0.2, 1] as const;
export const EASE_ACCELERATE = [0.4, 0, 1, 1] as const;
export const EASE_SPRING = [0.34, 1.56, 0.64, 1] as const;
export const EASE_SNAPPY = [0.2, 0, 0, 1] as const;

export function getPageVariants(reducedMotion: boolean): Variants {
  if (reducedMotion) {
    return {
      initial: { opacity: 1, y: 0 },
      animate: { opacity: 1, y: 0, transition: { duration: 0 } },
      exit: { opacity: 1, y: 0, transition: { duration: 0 } },
    };
  }
  return {
    initial: { opacity: 0, y: 8 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.25, ease: EASE_STANDARD },
    },
    exit: {
      opacity: 0,
      y: -4,
      transition: { duration: 0.15, ease: EASE_ACCELERATE },
    },
  };
}

/** Stagger cap: indices ≥8 share the same delay as index 7. */
export function listItemEnterDelay(index: number, staggerSec = 0.04): number {
  return Math.min(index, 7) * staggerSec;
}
