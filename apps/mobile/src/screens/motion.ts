import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing } from 'react-native';

// The Sandbee app's motion tokens (ui/theme/Motion.kt), so both apps move alike.
export const MOTION = { SHORT_MS: 200, MEDIUM_MS: 350, LONG_MS: 600 };
/** Material "emphasized": quick start, long settle. */
export const EMPHASIZED = Easing.bezier(0.2, 0, 0, 1);

/** One answer from Android: true when the user turned animations off. Errors read as "off". */
export function reducedMotionOnce(): Promise<boolean> {
  return AccessibilityInfo.isReduceMotionEnabled().catch(() => true);
}

// No JS animation tick or React state updates per frame. Unknown preference
// takes the still path until Android has answered.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let live = true;
    let changed = false;
    const listener = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      value => {
        changed = true;
        setReduced(value);
      },
    );
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (live && !changed) setReduced(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      listener.remove();
    };
  }, []);
  return reduced;
}
