import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/** Below `breakpointPx` (768 by default: the report sheets open from the bottom there). The dashboard nav passes the
 *  HTML's 720 px (U0 Task 2): the nav is a sheet only on a phone, the rail from 720 px up. */
export function useIsMobile(breakpointPx: number = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < breakpointPx);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < breakpointPx);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpointPx]);

  return !!isMobile;
}
