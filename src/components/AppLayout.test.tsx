import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { appTheme } from '../app/theme'
import { useSettingsStore } from '../stores/settingsStore'
import { AppLayout } from './AppLayout'

/**
 * `useMediaQuery(theme.breakpoints.up('md'))` reads `window.matchMedia`.
 * `src/test/setup.ts` stubs it to always report `matches: false`, which is
 * exactly the smartphone case. A desktop-mode test instead makes only the
 * query MUI actually evaluates for `md` (`(min-width:900px)`) match, then
 * every test restores the shared stub so other suites are unaffected.
 */
function mockDesktopViewport() {
  const desktopQuery = appTheme.breakpoints.up('md').replace('@media ', '')
  window.matchMedia = ((query: string) => ({
    matches: query === desktopQuery,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

const originalMatchMedia = window.matchMedia

/**
 * Lightweight stub routes stand in for the real pages.
 *
 * This suite is about AppLayout's own navigation, active-state, and AppBar
 * behaviour, not about any specific page's content, so it deliberately does
 * not render `PageShell` or a real page here (those are covered by
 * `PageShell.test.tsx` and `src/App.test.tsx`).
 */
function renderAppLayout(initialPath: string) {
  return render(
    <ThemeProvider theme={appTheme}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<div>ダッシュボード画面</div>} />
            <Route path="rng" element={<div>RNG画面</div>} />
            <Route path="normal-counters" element={<div>通常カウンター画面</div>} />
            <Route path="owned-weapons" element={<div>所持武器画面</div>} />
            <Route path="target-weapons" element={<div>目標武器画面</div>} />
            <Route path="search" element={<div>検索画面</div>} />
            <Route path="build-list" element={<div>ビルドリスト画面</div>} />
            <Route path="settings" element={<div>設定画面</div>} />
            <Route path="debug" element={<div>デバッグ画面</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('AppLayout', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset()
    window.matchMedia = originalMatchMedia
  })

  it('renders a permanent desktop Drawer reaching every primary screen, with no hamburger button', () => {
    mockDesktopViewport()
    renderAppLayout('/rng')

    expect(
      screen.queryByRole('button', { name: 'ナビゲーションを開く' }),
    ).not.toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    for (const label of [
      'ダッシュボード',
      'RNG状態設定',
      '通常アーティアカウンター',
      '所持武器',
      '目標武器',
      '候補検索',
      'ビルドリスト',
      '設定',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
    // Debug Modeが無効な間はデバッグ項目を表示しない。
    expect(within(nav).queryByRole('link', { name: 'デバッグ' })).not.toBeInTheDocument()
  })

  it('marks only the current route as the active navigation item', () => {
    mockDesktopViewport()
    renderAppLayout('/rng')

    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(within(nav).getByRole('link', { name: 'RNG状態設定' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'ダッシュボード' })).not.toHaveAttribute(
      'aria-current',
    )
    expect(within(nav).getByRole('link', { name: '所持武器' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('marks the Dashboard link active only at the root path, not at a nested one', () => {
    mockDesktopViewport()
    renderAppLayout('/')

    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(within(nav).getByRole('link', { name: 'ダッシュボード' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('shows the Debug navigation item once Debug Mode is on', () => {
    mockDesktopViewport()
    useSettingsStore.setState({ debugMode: true })
    renderAppLayout('/rng')

    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(within(nav).getByRole('link', { name: 'デバッグ' })).toBeInTheDocument()
  })

  it('identifies the current page in the AppBar', () => {
    mockDesktopViewport()
    renderAppLayout('/build-list')

    const banner = screen.getByRole('banner')
    expect(within(banner).getByText('ビルドリスト')).toBeInTheDocument()
  })

  it('falls back to the app name alone in the AppBar for an unmatched route', () => {
    mockDesktopViewport()
    render(
      <ThemeProvider theme={appTheme}>
        <MemoryRouter initialEntries={['/not-a-route']}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="*" element={<div>不明な画面</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )

    const banner = screen.getByRole('banner')
    expect(within(banner).getByText('Monster Hunter Wilds')).toBeInTheDocument()
  })

  it('opens the mobile Drawer from the hamburger button, reaching every primary screen', async () => {
    const user = userEvent.setup()
    renderAppLayout('/')

    const openButton = screen.getByRole('button', { name: 'ナビゲーションを開く' })
    await user.click(openButton)

    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    for (const label of ['RNG状態設定', '所持武器', '目標武器', '候補検索', 'ビルドリスト']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})
