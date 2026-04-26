import { createTheme } from '@mui/material/styles';

// Colors modeled on HA's Energy dashboard so the output feels consistent.
const ENERGY_COLORS = {
  grid: '#4f8cb9',       // cool blue
  solar: '#f2a825',      // amber
  battery: '#8e4fb9',    // violet
  gas: '#c45a5a',        // dusty red
  home: '#3aa07a',       // green
  co2Neutral: '#57c786', // brighter green for CO2 cards
};

export function createAppTheme(mode = 'dark') {
  return createTheme({
    palette: {
      mode,
      primary: { main: '#ffb300' },
      background:
        mode === 'dark'
          ? { default: '#111418', paper: '#1a1d22' }
          : { default: '#f5f6fa', paper: '#ffffff' },
      energy: ENERGY_COLORS,
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily:
        "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
      h1: { fontWeight: 700, letterSpacing: '-0.02em' },
      h2: { fontWeight: 700, letterSpacing: '-0.02em' },
      h3: { fontWeight: 700, letterSpacing: '-0.02em' },
      h4: { fontWeight: 700, letterSpacing: '-0.02em' },
      h5: { fontWeight: 700, letterSpacing: '-0.01em' },
      h6: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            fontFeatureSettings: '"tnum" 1, "cv11" 1',
            WebkitFontSmoothing: 'antialiased',
          },
          '.num': { fontFeatureSettings: '"tnum" 1' },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundImage: 'none',
            border: `1px solid ${
              theme.palette.mode === 'dark'
                ? 'rgba(255,255,255,0.06)'
                : 'rgba(0,0,0,0.06)'
            }`,
          }),
        },
      },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiAppBar: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundImage: 'none',
            backgroundColor: theme.palette.background.paper,
            borderBottom: `1px solid ${
              theme.palette.mode === 'dark'
                ? 'rgba(255,255,255,0.06)'
                : 'rgba(0,0,0,0.06)'
            }`,
          }),
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600, minHeight: 48 },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            textTransform: 'none',
            color: theme.palette.text.primary,
            '&:hover': { color: theme.palette.text.primary },
            '&.Mui-selected': {
              backgroundColor: theme.palette.action.selected,
              color: theme.palette.text.primary,
              fontWeight: 600,
              '&:hover': {
                backgroundColor: theme.palette.action.selected,
                color: theme.palette.text.primary,
              },
            },
          }),
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: ({ theme }) => ({
            color: theme.palette.text.primary,
            '&:hover': { color: theme.palette.text.primary },
            '&.Mui-focusVisible': { backgroundColor: theme.palette.action.hover },
          }),
        },
      },
    },
  });
}

export { ENERGY_COLORS };
