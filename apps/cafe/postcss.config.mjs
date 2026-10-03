const config = {
  // Android WebView is updated separately from Android. Older counter tablets (including
  // Chromium 109) can paint neither OKLCH tokens nor color-mix() tints. AFTER Tailwind: RGB
  // fallbacks for every colour (wide-gamut values kept in @supports), then real alpha fallbacks
  // for opacity tints such as bg-primary/10 (see postcss-tint-fallback.cjs).
  plugins: {
    "@tailwindcss/postcss": {},
    "@csstools/postcss-color-mix-function": { preserve: true },
    "@csstools/postcss-oklab-function": { preserve: true },
    "./postcss-tint-fallback.cjs": {},
  },
};

export default config;
