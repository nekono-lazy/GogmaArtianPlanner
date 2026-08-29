import { useState } from 'react'
import {
  AppBar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  SvgIcon,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { NavLink, Outlet } from 'react-router-dom'
import { useSettingsStore } from '../stores/settingsStore'

const drawerWidth = 256

const primaryNavigation = [
  { label: 'Dashboard', to: '/' },
  { label: 'RNG Setup', to: '/rng' },
  { label: 'Normal Counters', to: '/normal-counters' },
  { label: 'Owned Weapons', to: '/owned-weapons' },
  { label: 'Target Weapons', to: '/target-weapons' },
  { label: 'Search', to: '/search' },
  { label: 'Build List', to: '/build-list' },
]

function MenuIcon() {
  return (
    <SvgIcon>
      <path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z" />
    </SvgIcon>
  )
}

export function AppLayout() {
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const debugMode = useSettingsStore((state) => state.debugMode)

  const navigation = (
    <Box sx={{ width: drawerWidth }} role="navigation" aria-label="メインナビゲーション">
      <Toolbar>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Gogma Artian Planner
        </Typography>
      </Toolbar>
      <Divider />
      <List>
        {primaryNavigation.map((item) => (
          <ListItemButton
            key={item.to}
            component={NavLink}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMobileOpen(false)}
            sx={{ '&.active': { bgcolor: 'action.selected', color: 'primary.main' } }}
          >
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
      <Divider />
      <List>
        <ListItemButton component={NavLink} to="/settings" onClick={() => setMobileOpen(false)}>
          <ListItemText primary="Settings" />
        </ListItemButton>
        {debugMode && (
          <ListItemButton component={NavLink} to="/debug" onClick={() => setMobileOpen(false)}>
            <ListItemText primary="Debug" />
          </ListItemButton>
        )}
      </List>
    </Box>
  )

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', ml: { md: `${drawerWidth}px` }, width: { md: `calc(100% - ${drawerWidth}px)` } }}
      >
        <Toolbar>
          {!isDesktop && (
            <IconButton
              edge="start"
              aria-label="ナビゲーションを開く"
              onClick={() => setMobileOpen(true)}
              sx={{ mr: 1 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
            Monster Hunter Wilds
          </Typography>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth } }}
        >
          {navigation}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' } }}
        >
          {navigation}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, pt: 8, px: { xs: 2, sm: 3, lg: 5 }, pb: 5 }}>
        <Box sx={{ width: '100%', maxWidth: 1120, mx: 'auto', pt: { xs: 3, md: 4 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}
