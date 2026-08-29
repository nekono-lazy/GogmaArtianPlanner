import { useEffect } from 'react'
import { Alert, Box, CssBaseline, Typography } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { appTheme } from './app/theme'
import { loadMasterData } from './domain/master/loadMasterData'
import { settingsRepository } from './db/settingsRepository'
import { useSettingsStore } from './stores/settingsStore'
import { DashboardPage } from './pages/DashboardPage'
import { DebugPage } from './pages/DebugPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SettingsPage } from './pages/SettingsPage'
import { SearchPage } from './pages/SearchPage'
import { BuildListPage } from './pages/BuildListPage'
import {
  ExecutionNavigatorPage,
  NormalCountersPage,
  OwnedWeaponsPage,
  ProductionPlanPage,
  RngSetupPage,
  TargetWeaponsPage,
} from './pages/StaticPages'

const masterData = loadMasterData()

function SettingsBootstrap() {
  const hydrate = useSettingsStore((state) => state.hydrate)

  useEffect(() => {
    let active = true
    void settingsRepository
      .getOrCreateDefault()
      .then((settings) => {
        if (active) hydrate(settings)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [hydrate])

  return null
}

function ApplicationRoutes() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="rng" element={<RngSetupPage />} />
          <Route path="normal-counters" element={<NormalCountersPage />} />
          <Route path="owned-weapons" element={<OwnedWeaponsPage />} />
          <Route path="target-weapons" element={<TargetWeaponsPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="build-list" element={<BuildListPage />} />
          <Route path="plans/:planId" element={<ProductionPlanPage />} />
          <Route path="plans/:planId/run" element={<ExecutionNavigatorPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="debug" element={<DebugPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

function App() {
  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      {masterData.ok ? (
        <>
          <SettingsBootstrap />
          <ApplicationRoutes />
        </>
      ) : (
        <Box sx={{ maxWidth: 720, mx: 'auto', p: 4 }}>
          <Typography component="h1" variant="h1" gutterBottom>
            Startup Error
          </Typography>
          <Alert severity="error">
            Master Dataの検証に失敗しました:{' '}
            {masterData.issues.map((issue) => issue.message).join(' / ')}
          </Alert>
        </Box>
      )}
    </ThemeProvider>
  )
}

export default App
