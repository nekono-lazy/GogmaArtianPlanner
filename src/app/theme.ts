import { createTheme } from '@mui/material/styles'

/**
 * Application theme: the design foundation every screen builds on.
 *
 * Direction: a calm, border-based Minimalism / Swiss style for a professional
 * planning tool (see the UI redesign analysis). The existing dark-green primary
 * and brown secondary are kept; semantic colours, the full typography scale,
 * shape, and a few safe component defaults are made explicit here so screens
 * do not have to repeat them in `sx`.
 *
 * Boundaries this file deliberately respects:
 *
 * - `Typography.variantMapping` is untouched: a `variant="h3"` still renders an
 *   `<h3>`, so heading semantics never change from the theme alone.
 * - The theme changes visual tokens (type scale, radius, borders, Accordion
 *   gutters, Card variant) but never DOM structure or page-level layout:
 *   Buttons are never made full width, nothing is turned into a fixed action
 *   bar, and no default control `size` is reduced.
 * - Responsive rules follow `docs/UI_FLOW.md` 3.1: the small-screen value is the
 *   base and larger breakpoints add density.
 */

/** System font stack: no web font is bundled or fetched. */
const fontFamily = [
  'system-ui',
  '-apple-system',
  '"Segoe UI"',
  'Roboto',
  '"Hiragino Sans"',
  '"Hiragino Kaku Gothic ProN"',
  '"Yu Gothic UI"',
  '"Noto Sans JP"',
  '"Noto Sans CJK JP"',
  'Meiryo',
  'sans-serif',
].join(', ')

const headingLineHeight = 1.35
const bodyLineHeight = 1.6

/** Breakpoint helpers from a default theme, usable before `appTheme` exists. */
const { breakpoints } = createTheme()

/**
 * Body text is 16px on small screens so iOS Safari does not zoom focused
 * inputs, and 15px from `md` up where the denser desktop layout benefits from
 * it. The media query lives inside `body1` itself, so `InputBase`,
 * `InputLabel` and the `CssBaseline` body, which all spread `body1`, follow it
 * without separate overrides.
 */
const body1 = {
  fontSize: '1rem',
  lineHeight: bodyLineHeight,
  [breakpoints.up('md')]: { fontSize: '0.9375rem' },
}

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#394f46',
      light: '#5f7a6f',
      dark: '#263831',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#8a5a33',
      light: '#a67a52',
      dark: '#5e3c20',
      contrastText: '#ffffff',
    },
    success: { main: '#2e7d32' },
    warning: { main: '#a35a00', contrastText: '#ffffff' },
    error: { main: '#b3261e' },
    info: { main: '#35697a' },
    text: {
      primary: '#1c1f1d',
      secondary: '#5b615d',
    },
    divider: '#dfe2dc',
    background: { default: '#f5f5f1', paper: '#ffffff' },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily,
    h1: { fontSize: '1.5rem', fontWeight: 600, lineHeight: headingLineHeight },
    h2: { fontSize: '1.125rem', fontWeight: 600, lineHeight: headingLineHeight },
    h3: { fontSize: '1rem', fontWeight: 600, lineHeight: headingLineHeight },
    // The product's heading depth is h1 (page) > h2 (section) > h3 (card).
    // h4-h6 are defined for completeness and for MUI internals (DialogTitle,
    // CardHeader) as compact, label-grade headings that mirror subtitle1 /
    // subtitle2; on small screens they are not larger than body1, so a deeper
    // semantic heading should pair `component="h4"` with an h2 / h3 / subtitle
    // variant, as ProductionPlanWhatIfComparison already does.
    h4: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: headingLineHeight },
    h5: { fontSize: '0.875rem', fontWeight: 600, lineHeight: headingLineHeight },
    h6: { fontSize: '0.8125rem', fontWeight: 600, lineHeight: headingLineHeight },
    subtitle1: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.5 },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.5 },
    body1,
    body2: { fontSize: '0.8125rem', lineHeight: bodyLineHeight },
    button: { fontSize: '0.875rem', fontWeight: 600, textTransform: 'none' },
    caption: { fontSize: '0.75rem', lineHeight: 1.5 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Opt-in helper for counters, positions and other aligned figures.
        '.tabular-nums': { fontVariantNumeric: 'tabular-nums' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
    },
    MuiChip: {
      styleOverrides: {
        label: { fontWeight: 500 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        message: {
          // Hashes and IDs shown in notices must wrap instead of overflowing
          // a narrow screen.
          minWidth: 0,
          overflowWrap: 'anywhere',
        },
      },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0 },
      styleOverrides: {
        root: ({ theme }) => ({
          border: `1px solid ${theme.palette.divider}`,
          '&::before': { display: 'none' },
        }),
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        // MUI's DialogTitle reuses the `h6` style, which is a minor heading
        // in this scale; a dialog title reads at section-heading size.
        root: ({ theme }) => ({ ...theme.typography.h2 }),
      },
    },
    MuiTable: {
      defaultProps: { size: 'small' },
    },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600 },
        alignRight: { fontVariantNumeric: 'tabular-nums' },
      },
    },
  },
})
