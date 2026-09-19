/**
 * Quiztape design tokens.
 *
 * Direction: neon retro cassette (80s/90s synthwave, VHS) executed with restraint.
 * Magenta doubles as the Side A colour, cyan as the Side B colour.
 *
 * Fonts are named slots; the actual faces are loaded with expo-font in the
 * cassette-UI step so that web, iOS and Android all ship the same files.
 */

export const palette = {
  /** Deep near-black base. */
  base: '#0B0B10',
  baseElevated: '#14141C',
  baseSunken: '#060609',
  /** Side A. */
  magenta: '#FF2E9A',
  magentaDim: '#8A1655',
  /** Side B. */
  cyan: '#2EF2FF',
  cyanDim: '#137F87',
  /** Warm tape cream, the default text colour. */
  cream: '#F3E9D2',
  creamMuted: '#B8AE99',
  /** Chrome for borders, dividers and the tape shell. */
  chrome: '#8C93A1',
  chromeDim: '#3A3F4B',
  /** Feedback. */
  correct: '#3DFFA8',
  wrong: '#FF5C5C',
} as const;

export const side = {
  a: palette.magenta,
  b: palette.cyan,
} as const;

export const fonts = {
  /** Bold condensed display face for headers. */
  display: 'QuiztapeDisplay',
  /** Clean monospace for data and labels. */
  mono: 'QuiztapeMono',
  /** Marker / handwritten face for cassette J-card question labels. */
  marker: 'QuiztapeMarker',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 16,
  pill: 999,
} as const;

export const layout = {
  /** Cassette cards and forms never stretch wider than this on the web. */
  maxContentWidth: 640,
} as const;

/** Minimum focus ring for keyboard users; applied to interactive elements. */
export const focusRing = {
  borderWidth: 2,
  borderColor: palette.cyan,
} as const;
