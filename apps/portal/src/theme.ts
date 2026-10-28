import { createOxygenTheme, OxygenTheme } from '@wso2/oxygen-ui';

/**
 * One place where every colour in this app is defined.
 *
 * Components reference palette roles (`primary.main`, `surface.low`) and never
 * literal hex or rgba values, so a rebrand is an edit to this file rather than
 * a search across the tree -- and two things that are meant to look alike
 * cannot drift apart because someone pasted a slightly different blue.
 *
 * "Apex Acrylic Blue": Oxygen UI's acrylic base -- frosted surfaces over a
 * softly lit page -- with a blue and slate-grey glow on a grey page in place
 * of WSO2's orange and violet, in light and dark. The consent portal wears the same theme, so moving between the two
 * reads as one product.
 *
 * KEEP IN SYNC with external-services/consent/apex-theme/apexTheme.ts. That
 * copy is built against the consent portal's Oxygen UI 0.8.3, which has no
 * createOxygenTheme; only the last few lines differ. Change a value here,
 * change it there.
 */

/** M3 surface containers and the tertiary ("rewards") hue -- real palette
 * roles, so they are declared to MUI rather than kept in a side object that
 * `sx` has to import. */
declare module '@mui/material/styles' {
  interface Palette {
    surface: { lowest: string; low: string; main: string; high: string };
    tertiary: { main: string; container: string; fixed: string };
    /** Translucent fills for the frosted-glass surfaces. */
    glass: { fill: string; fillStrong: string; border: string; shadow: string };
  }
  interface PaletteOptions {
    surface?: { lowest: string; low: string; main: string; high: string };
    tertiary?: { main: string; container: string; fixed: string };
    glass?: { fill: string; fillStrong: string; border: string; shadow: string };
  }
}

/** "#rrggbb[aa]" -> "r g b", the form MUI's `*Channel` variables take. */
function channel(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Mix a hex colour toward white (amount > 0) or black (amount < 0). */
function mix(hex: string, amount: number): string {
  const [r, g, b] = channel(hex).split(' ').map(Number);
  const to = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  return `rgb(${[r, g, b].map((c) => Math.round(c + (to - c) * k)).join(', ')})`;
}

/** Fill in what MUI derives from a palette.
 *
 * MUI computes the `*Channel` variables (every translucent tint -- hover,
 * focus, selection -- is `rgba(var(--…-mainChannel) / x)`) and the component
 * tracks (LinearProgress, Slider) once, when a theme is first built. Extending
 * the acrylic base keeps the base's values, which are orange: the hex says
 * blue while every tint and progress track stays orange. So they are derived
 * here, from this palette, the way MUI would.
 */
function withDerived(palette: Record<string, any>, mode: 'light' | 'dark') {
  const out: Record<string, any> = { ...palette };
  for (const [group, value] of Object.entries(palette)) {
    if (typeof value === 'string' && value.startsWith('#')) {
      out[`${group}Channel`] = channel(value);
    } else if (value && typeof value === 'object') {
      const derived: Record<string, string> = {};
      for (const [key, colour] of Object.entries(value)) {
        if (typeof colour === 'string' && colour.startsWith('#')) derived[`${key}Channel`] = channel(colour);
      }
      out[group] = { ...value, ...derived };
    }
  }
  const tracks: Record<string, string> = {};
  const sliders: Record<string, string> = {};
  for (const key of ['primary', 'secondary', 'success', 'error']) {
    const main = palette[key]?.main;
    if (!main) continue;
    tracks[`${key}Bg`] = mode === 'light' ? mix(main, 0.62) : mix(main, -0.5);
    sliders[`${key}Track`] = mode === 'light' ? mix(main, 0.62) : mix(main, -0.5);
  }
  out.LinearProgress = tracks;
  out.Slider = sliders;
  return out;
}

const gradient = { primary: 'linear-gradient(90deg, #1a66e0 0%, #0040a8 100%)' };

const config = {
  colorSchemes: {
    light: {
      palette: withDerived({
        primary: { main: '#0050cb', dark: '#003fa4', light: '#dae1ff', contrastText: '#ffffff' },
        secondary: { main: '#e5eaf5', contrastText: '#0b1c30' },
        success: { main: '#0f9d58', contrastText: '#ffffff' },
        error: { main: '#ba1a1a', contrastText: '#ffffff' },
        background: { default: '#f3f4f6', paper: '#ffffffd9', acrylic: '#ffffff73' },
        text: { primary: '#0b1c30', secondary: '#424656' },
        divider: '#0b1c3014',
        action: { selected: 'rgba(0, 80, 203, 0.12)', selectedOpacity: 0.12 },
        surface: { lowest: '#ffffff', low: '#eff4ff', main: '#e5eeff', high: '#dce9ff' },
        tertiary: { main: '#a33200', container: '#cc4204', fixed: '#ffdbd0' },
        glass: {
          fill: 'rgba(255, 255, 255, 0.7)',
          fillStrong: 'rgba(255, 255, 255, 0.85)',
          border: 'rgba(255, 255, 255, 0.5)',
          shadow: '0 8px 32px 0 rgba(31, 38, 135, 0.04)',
        },
      }, 'light'),
    },
    dark: {
      palette: withDerived({
        primary: { main: '#4d8dff', dark: '#2f6fe8', light: '#1d2f55', contrastText: '#ffffff' },
        secondary: { main: '#1e2738', contrastText: '#e6ecf7' },
        success: { main: '#34c27a', contrastText: '#ffffff' },
        error: { main: '#ff6b6b', contrastText: '#ffffff' },
        background: { default: '#07090d', paper: '#11151dd9', acrylic: '#11151d73' },
        text: { primary: '#e6ecf7', secondary: '#b3bdd1' },
        divider: '#ffffff16',
        action: { selected: 'rgba(77, 141, 255, 0.2)', selectedOpacity: 0.2 },
        surface: { lowest: '#0a0f1b', low: '#121b2e', main: '#17223a', high: '#1d2a46' },
        tertiary: { main: '#ffb59c', container: '#cc4204', fixed: '#5c1a00' },
        glass: {
          fill: 'rgba(13, 20, 36, 0.6)',
          fillStrong: 'rgba(13, 20, 36, 0.8)',
          border: 'rgba(255, 255, 255, 0.08)',
          shadow: '0 8px 32px 0 rgba(0, 0, 0, 0.35)',
        },
      }, 'dark'),
    },
  },
  typography: {
    fontFamily: "'Inter', sans-serif",
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "html[data-color-scheme='dark'] body": {
          backgroundAttachment: 'fixed',
          backgroundImage: `
            radial-gradient(circle at 65% 30%, rgb(30 111 255 / 26%) 10%, rgba(0, 0, 0, 0) 60% 40%),
            radial-gradient(circle at 15% 50%, rgb(100 116 139 / 24%) 1%, rgba(0, 0, 0, 0) 40% 70%),
            radial-gradient(circle at center, rgba(0, 0, 0, 0.6) 0%, var(--oxygen-palette-background-default) 100%)
          `,
          backgroundBlendMode: 'screen',
        },
        "html[data-color-scheme='light'] body": {
          backgroundAttachment: 'fixed',
          backgroundImage: `
            radial-gradient(circle at 65% 30%, rgba(30, 111, 255, 0.16) 10%, rgba(255, 255, 255, 0) 40% 40%),
            radial-gradient(circle at 15% 50%, rgba(71, 85, 105, 0.14) 1%, rgba(255, 255, 255, 0) 40% 70%),
            radial-gradient(circle at center, rgba(255, 255, 255, 0.6) 0%, var(--oxygen-palette-background-default) 100%)
          `,
          backgroundBlendMode: 'normal',
        },
      },
    },
  },
};

// The acrylic base's buttons and Fab paint `theme.gradient.primary`, which is
// a custom property rather than a palette role -- set on the built theme, as
// Oxygen UI's own coloured themes do.
export const theme = createOxygenTheme(config, OxygenTheme);
Object.assign(theme, { gradient });
if (theme.vars) Object.assign(theme.vars, { gradient });
