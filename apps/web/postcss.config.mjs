/**
 * Next's own PostCSS defaults (a custom config replaces them, so they are listed here as Next lists
 * them, from the copies Next ships), then the squircle corners (postcss-squircle.cjs).
 */
const config = {
  plugins: {
    'next/dist/compiled/postcss-flexbugs-fixes': {},
    'next/dist/compiled/postcss-preset-env': {
      browsers: ['defaults'],
      autoprefixer: { flexbox: 'no-2009' },
      stage: 3,
      features: { 'custom-properties': false },
    },
    './postcss-squircle.cjs': {},
  },
};

export default config;
