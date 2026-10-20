// The owner's HTML's global rules on the staff screens (values 1.4, ruling R24): while this hidden marker is in the
// document, app/globals.css gives <html> the HTML's body stack ('Geist', system-ui, -apple-system, 'Segoe UI',
// sans-serif, so a glyph Geist lacks falls back as the HTML's does) and its tabular figures, through
// html:has([data-html-rules]) — which also reaches the dialogs and sheets that portal to <body>. Only the dashboard
// shell and the sign-in screen render it: the /m diner flow never does, and a print iframe never contains it (it
// copies the slip, not the shell). Server-rendered, so the rules hold from the first paint.
export function HtmlRulesScope() {
  return <span hidden data-html-rules="" />;
}
