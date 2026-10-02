import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

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
