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
  ListSubheader,
  Stack,
  SvgIcon,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { matchPath, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSettingsStore } from '../stores/settingsStore'

const drawerWidth = 240

interface NavigationItem {
  label: string
  to: string
  /** Only the Dashboard needs `end`, since every other path is a distinct leaf. */
  end?: boolean
}

interface NavigationGroup {
  /** `null` renders no `ListSubheader`; used for the single Dashboard entry point. */
  label: string | null
  items: NavigationItem[]
}

/**
 * Primary navigation, grouped by purpose (`docs/UI_FLOW.md` 2).
 *
 * Every group is shown on both PC and smartphone: the device never narrows
 * which screens are reachable (`docs/UI_FLOW.md` 3.1).
 */
const navigationGroups: NavigationGroup[] = [
  { label: null, items: [{ label: 'ダッシュボード', to: '/', end: true }] },
  {
    label: '準備',
    items: [
      { label: 'RNG状態設定', to: '/rng' },
      { label: '通常アーティアカウンター', to: '/normal-counters' },
      { label: '所持武器', to: '/owned-weapons' },
      { label: '目標武器', to: '/target-weapons' },
    ],
  },
  {
    label: '計画',
    items: [
      { label: '候補検索', to: '/search' },
      { label: 'ビルドリスト', to: '/build-list' },
    ],
  },
]

interface RouteTitle {
  pattern: string
  end?: boolean
  label: string
}

/**
 * Route -> current page label lookup, used only to identify the current page
 * in the AppBar.
 *
 * Covers every path `App.tsx` registers, including the dynamic Production
 * Plan / Execution Navigator routes that have no permanent Drawer entry
 * (they are reached from Build List / Dashboard once a Plan exists). Order
 * matters: a more specific pattern is listed before a less specific one that
 * would also match it (`/plans/:planId/run` before `/plans/:planId`). This is
 * a read-only presentation lookup; it does not change any Router path or
 * navigation semantics.
 */
const routeTitles: RouteTitle[] = [
  { pattern: '/', end: true, label: 'ダッシュボード' },
  { pattern: '/rng', label: 'RNG状態設定' },
  { pattern: '/normal-counters', label: '通常アーティアカウンター' },
  { pattern: '/owned-weapons', label: '所持武器' },
  { pattern: '/target-weapons', label: '目標武器' },
  { pattern: '/search', label: '候補検索' },
  { pattern: '/build-list', label: 'ビルドリスト' },
  { pattern: '/plans/:planId/run', label: '実行ナビゲーション' },
  { pattern: '/plans/:planId', label: '生産計画' },
  { pattern: '/settings', label: '設定' },
  { pattern: '/debug', label: 'デバッグ' },
]

function useCurrentPageLabel(): string | null {
  const { pathname } = useLocation()
  const matched = routeTitles.find((route) =>
    matchPath({ path: route.pattern, end: route.end ?? true }, pathname),
  )
  return matched?.label ?? null
}

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
  const currentPageLabel = useCurrentPageLabel()

  /**
   * Shared active/hover/focus styling for every navigation link.
   *
   * The active indicator combines a left border, a background tint, and a
   * bolder + coloured label - never colour alone. The border is always
   * reserved at its active width (transparent when inactive) so becoming
   * active never shifts the label position. Focus-visible gets an explicit
   * outline so keyboard navigation stays visible regardless of browser
   * defaults for a `component={NavLink}` root.
   */
  const navigationItemSx = {
    borderLeft: '3px solid transparent',
    '&:hover': { bgcolor: 'action.hover' },
    '&.Mui-focusVisible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: '-2px',
    },
    '&.active': {
      bgcolor: 'action.selected',
      borderLeftColor: 'primary.main',
      '& .MuiListItemText-primary': {
        color: 'primary.main',
        fontWeight: 600,
      },
    },
  } as const

  const navigationContent = (
    <Box sx={{ width: drawerWidth }} role="navigation" aria-label="メインナビゲーション">
      <Toolbar>
        <Typography variant="subtitle1">Gogma Artian Planner</Typography>
      </Toolbar>
      <Divider />
      {navigationGroups.map((group, groupIndex) => (
        <List
          key={group.label ?? `group-${groupIndex}`}
          subheader={
            group.label ? (
              <ListSubheader component="div" disableSticky>
                {group.label}
              </ListSubheader>
            ) : undefined
          }
        >
          {group.items.map((item) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              sx={navigationItemSx}
            >
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      ))}
      <Divider />
      <List>
        <ListItemButton
          component={NavLink}
          to="/settings"
          onClick={() => setMobileOpen(false)}
          sx={navigationItemSx}
        >
          <ListItemText primary="設定" />
        </ListItemButton>
        {debugMode && (
          <ListItemButton
            component={NavLink}
            to="/debug"
            onClick={() => setMobileOpen(false)}
            sx={navigationItemSx}
          >
            <ListItemText primary="デバッグ" />
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
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          ml: { md: `${drawerWidth}px` },
          width: { md: `calc(100% - ${drawerWidth}px)` },
        }}
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
          {/*
            Hierarchy: the current page name is always shown and never
            truncated away; the app's thematic brand line is secondary and
            only joins it once there is room (sm and up), so the AppBar
            still identifies "where am I" on the narrowest phones without
            growing past its existing single-row height.
          */}
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', minWidth: 0 }}>
            {currentPageLabel ? (
              <>
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  noWrap
                  sx={{ display: { xs: 'none', sm: 'block' } }}
                >
                  Monster Hunter Wilds ／
                </Typography>
                <Typography variant="subtitle1" component="span" noWrap sx={{ minWidth: 0 }}>
                  {currentPageLabel}
                </Typography>
              </>
            ) : (
              <Typography variant="subtitle1" noWrap>
                Monster Hunter Wilds
              </Typography>
            )}
          </Stack>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        {isDesktop ? (
          <Drawer
            variant="permanent"
            open
            sx={{ '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' } }}
          >
            {navigationContent}
          </Drawer>
        ) : (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ '& .MuiDrawer-paper': { width: drawerWidth } }}
          >
            {navigationContent}
          </Drawer>
        )}
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, pt: 8, px: { xs: 2, sm: 3, lg: 5 }, pb: 5 }}>
        <Box sx={{ width: '100%', maxWidth: 1120, mx: 'auto', pt: { xs: 3, md: 4 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}
