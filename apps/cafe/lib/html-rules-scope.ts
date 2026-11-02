// The staff screens' global rules (ruling R24, F1 of the 2026-11-02 perf design): app/globals.css scopes them to
// html[data-html-rules] — a plain attribute selector on <html>, not html:has([data-html-rules]), which made the browser
// re-check the whole document on every DOM change (report docs/perf/2026-11-02-p1-measurements.md §3). The attribute is
// set before the first paint by HTML_RULES_SCRIPT (the dashboard layout and the login page render it) and kept by the
// ref-counted HtmlRulesScope component across client navigations. Dependency-free, like lib/nav-state-script.ts.

export const HTML_RULES_ATTR = "data-html-rules";

export const HTML_RULES_SCRIPT = 'try{document.documentElement.setAttribute("data-html-rules","")}catch(e){}';

let mounted = 0;

type Root = { setAttribute(n: string, v: string): void; removeAttribute(n: string): void };

/** Marks `root` as a staff screen; the returned release removes the mark when the last holder lets go. */
export function acquireHtmlRules(root: Root): () => void {
  mounted += 1;
  root.setAttribute(HTML_RULES_ATTR, "");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mounted -= 1;
    if (mounted <= 0) {
      mounted = 0;
      root.removeAttribute(HTML_RULES_ATTR);
    }
  };
}
