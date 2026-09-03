import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { appTheme } from './app/theme'
import { SkillIdentificationBenchmarkPage } from './pages/SkillIdentificationBenchmarkPage'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <SkillIdentificationBenchmarkPage />
    </ThemeProvider>
  </StrictMode>,
)
