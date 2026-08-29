import { createTheme } from '@mui/material/styles'

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#394f46' },
    secondary: { main: '#8a5a33' },
    background: { default: '#f5f5f1', paper: '#ffffff' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily:
      'Inter, "Noto Sans JP", "Yu Gothic UI", "Yu Gothic", system-ui, sans-serif',
    h1: { fontSize: 'clamp(1.8rem, 5vw, 2.5rem)', fontWeight: 700 },
    h2: { fontSize: '1.3rem', fontWeight: 700 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiCard: { styleOverrides: { root: { border: '1px solid #e3e4df' } } },
  },
})
