import { motion, useReducedMotion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';

// Fades + slides a block in once it scrolls into view. Skips the animation entirely under
// prefers-reduced-motion (useReducedMotion) instead of just shortening it.
//
// `style` is required whenever Reveal is placed as a direct child of a flex/grid container
// (e.g. one Reveal per card in a flex-wrap row) — the wrapping div becomes the real flex/grid
// item, so sizing props like flex-basis/minWidth/maxWidth must move here, not stay on the
// child being animated, or the layout silently stops sizing/stretching correctly.
export default function Reveal({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: CSSProperties }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div style={style}>{children}</div>;

  return (
    <motion.div
      style={style}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
