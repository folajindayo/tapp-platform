// Motion primitives shared across animated UI components.
// Mirrors users-app/components/ui/motion/motion.ts so behaviour stays in
// sync across both apps.

import { Easing } from 'react-native-reanimated';

/**
 * iOS-flavoured ease curve used for component transitions (tier morphs,
 * digit reel rolls, slot enter/exit). Snappier than Material's default;
 * matches the spring feel of the rest of the system.
 */
// .factory() unwraps Reanimated's EasingFactory into a plain EasingFunction
// — FadeIn/FadeOut/LinearTransition's `.easing()` accepts the latter only.
// `withTiming({ easing: ... })` accepts both, so this form is universally
// compatible.
export const STANDARD_CURVE = Easing.bezier(0.32, 0.72, 0, 1).factory();
