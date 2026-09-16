"use client";

import { useCallback, useInsertionEffect, useRef } from "react";

// A referentially STABLE function that always invokes the LATEST callback it was
// given — the "latest ref" pattern (the shape Radix's useCallbackRef and the React
// team's useEffectEvent polyfill use). Why it exists: usePosTab's orchestration
// closures (confirmPayment, applyTabUpdate, requestResume, selectTable, the
// prompt confirms) are re-minted on every render because they read the live
// cart/state, and a fresh function prop defeats a React.memo child every render.
// Latching them here fixes the child's prop identity while every call still
// reaches the closure from the most recent commit — exactly the function the
// child would have received as a fresh prop — so behaviour is unchanged.
//
// Why useInsertionEffect, not a render-phase write or useLayoutEffect: React runs
// every insertion effect in the commit's MUTATION phase, before ANY layout or
// passive effect anywhere in the tree (react-dom commitRoot: flushMutationEffects
// then flushLayoutEffects), so a child that invokes the callback from its own
// effect in the same commit (MoveTableDialog fires onMoved from a useEffect)
// always sees the latest closure. A render-phase write is forbidden by the rules
// of hooks — it could publish a closure from a render that never commits.
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const latest = useRef(fn);
  useInsertionEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
