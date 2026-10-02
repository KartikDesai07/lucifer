const config = {
  // Android WebView is updated separately from Android. Older counter tablets
  // (including Chromium 109) cannot paint OKLCH tokens. Generate RGB fallbacks
  // AFTER Tailwind, including its palette; retain wide-gamut colors in @supports.
  plugins: {
    "@tailwindcss/postcss": {},
    "@csstools/postcss-color-mix-function": { preserve: true },
    "@csstools/postcss-oklab-function": { preserve: true },
  },
};

export default config;
