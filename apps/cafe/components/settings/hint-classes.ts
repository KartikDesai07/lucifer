// The settings hint styles on their own (SettingsFields re-exports them), so a light screen outside Settings — the
// Kitchen header's Now Serving link — can match the look without pulling the settings field kit (Switch, Label, the
// section list) into its first load.
export const HINT_CLASS = "text-xs text-brand-muted";
// Always underlined: inside muted hint text, colour alone would not mark it as a link.
export const HINT_LINK_CLASS = "font-medium text-brand-primary underline underline-offset-2";
