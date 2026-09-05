import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { appTheme } from './app/theme'
import { BenchmarkApp } from './pages/BenchmarkApp'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <BenchmarkApp />
    </ThemeProvider>
  </StrictMode>,
)
