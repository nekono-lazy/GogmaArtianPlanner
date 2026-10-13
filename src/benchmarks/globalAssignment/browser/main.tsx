import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Container, CssBaseline } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { appTheme } from '../../../app/theme'
import { GlobalAssignmentBrowserBenchmarkPage } from './GlobalAssignmentBrowserBenchmarkPage'
import '../../../index.css'

/**
 * Issue #154 Production準備 P-1: the page entry of `benchmark-global-assignment.html` (the second input of `vite.benchmark.config.ts`).
 * It is not part of the normal application (`index.html` / `vite.config.ts`) or of the existing `benchmark.html` shell.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ px: { xs: 2, sm: 3 } }}>
        <GlobalAssignmentBrowserBenchmarkPage />
      </Container>
    </ThemeProvider>
  </StrictMode>,
)
