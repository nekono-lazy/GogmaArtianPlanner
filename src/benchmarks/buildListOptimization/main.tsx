import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Container, CssBaseline } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { appTheme } from '../../app/theme'
import { BuildListOptimizationBenchmarkPage } from './BuildListOptimizationBenchmarkPage'
import '../../index.css'

/**
 * Issue #260 PR-5A: the page entry of `benchmark-build-list-optimization.html` (an input of `vite.benchmark.config.ts` only). It is not
 * part of the normal application (`index.html` / `vite.config.ts`), GitHub Pages or the other benchmark pages.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ px: { xs: 2, sm: 3 } }}>
        <BuildListOptimizationBenchmarkPage />
      </Container>
    </ThemeProvider>
  </StrictMode>,
)
