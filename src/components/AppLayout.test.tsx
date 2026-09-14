import { render, screen, waitFor, within } from '@testing-library/react'
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
            <Route path="plans/:planId" element={<div>生産計画画面</div>} />
            <Route path="plans/:planId/run" element={<div>実行ナビゲーション画面</div>} />
            <Route path="settings" element={<div>設定画面</div>} />
            <Route path="debug" element={<div>デバッグ画面</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

/** Every primary screen the Drawer must reach on both devices (`docs/UI_FLOW.md` 2.1). */
const primaryScreens = [
  'ダッシュボード',
  '所持武器',
  '目標武器',
  '候補検索',
  'ビルドリスト',
  'RNG状態設定',
  '通常アーティアカウンター',
  '設定',
]

/**
 * The Drawer's group headings and links in document order, so grouping and
 * order are asserted as one sequence rather than as a set.
 */
function navigationSequence(nav: HTMLElement): string[] {
  return Array.from(nav.querySelectorAll('.MuiListSubheader-root, a')).map(
    (element) => element.textContent ?? '',
  )
}

const expectedSequence = [
  'ダッシュボード',
  '管理',
  '所持武器',
  '目標武器',
  '計画',
  '候補検索',
  'ビルドリスト',
  '初期設定',
  'RNG状態設定',
  '通常アーティアカウンター',
  '設定',
]

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
    for (const label of primaryScreens) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
    // Debug Modeが無効な間はデバッグ項目を表示しない。
    expect(within(nav).queryByRole('link', { name: 'デバッグ' })).not.toBeInTheDocument()
  })

  it('groups and orders the navigation as 管理 / 計画, then 初期設定 and 設定', () => {
    mockDesktopViewport()
    renderAppLayout('/')

    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(navigationSequence(nav)).toEqual(expectedSequence)
    // The former 準備 group no longer exists.
    expect(within(nav).queryByText('準備')).not.toBeInTheDocument()
  })

  it('appends デバッグ after 設定 once Debug Mode is on, without reordering anything else', () => {
    mockDesktopViewport()
    useSettingsStore.setState({ debugMode: true })
    renderAppLayout('/rng')

    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(within(nav).getByRole('link', { name: 'デバッグ' })).toBeInTheDocument()
    expect(navigationSequence(nav)).toEqual([...expectedSequence, 'デバッグ'])
  })

  it('has no permanent entry for Production Plan or Execution Navigator', () => {
    mockDesktopViewport()
    renderAppLayout('/plans/plan-1')

    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
    expect(hrefs.some((href) => href.includes('/plans'))).toBe(false)
    expect(within(nav).queryByRole('link', { name: '生産計画' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: '実行ナビゲーション' })).not.toBeInTheDocument()
    // The route itself is still reachable and still identified in the AppBar.
    expect(screen.getByText('生産計画画面')).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByText('生産計画')).toBeInTheDocument()
  })

  it('identifies the Execution Navigator route in the AppBar without a Drawer entry', () => {
    mockDesktopViewport()
    renderAppLayout('/plans/plan-1/run')

    expect(within(screen.getByRole('banner')).getByText('実行ナビゲーション')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(within(nav).queryAllByRole('link', { current: 'page' })).toHaveLength(0)
  })

  it('does not give the navigation content a fixed width of its own', () => {
    // The Drawer paper is `overflow-y: auto`; once its vertical scrollbar
    // appears the usable width is narrower than `drawerWidth`, so a child
    // fixed at the full paper width would overflow horizontally. The content
    // must therefore fill the paper's usable width instead
    // (`docs/UI_FLOW.md` 2.1).
    mockDesktopViewport()
    renderAppLayout('/rng')

    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(getComputedStyle(nav).width).not.toBe('240px')
    expect(getComputedStyle(nav).minWidth).toBe('0px')
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

  it.each([
    ['/owned-weapons', '所持武器'],
    ['/target-weapons', '目標武器'],
    ['/search', '候補検索'],
    ['/build-list', 'ビルドリスト'],
    ['/normal-counters', '通常アーティアカウンター'],
    ['/settings', '設定'],
  ])('keeps the active indicator on %s after the regrouping', (path, label) => {
    mockDesktopViewport()
    renderAppLayout(path)

    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getAllByRole('link', { current: 'page' })).toHaveLength(1)
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

  it('exposes exactly one navigation landmark and one main landmark on desktop', () => {
    mockDesktopViewport()
    renderAppLayout('/rng')

    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
  })

  it('leaves no empty navigation landmark around the closed mobile Drawer', () => {
    renderAppLayout('/rng')

    // The temporary Drawer is kept mounted but hidden, so no navigation
    // landmark - and in particular no empty one - is exposed while closed.
    expect(screen.queryAllByRole('navigation')).toHaveLength(0)
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
  })

  it('offers a skip link that moves keyboard focus to the main content without changing the route', async () => {
    const user = userEvent.setup()
    mockDesktopViewport()
    renderAppLayout('/rng')

    await user.tab()
    const skipLink = screen.getByRole('link', { name: 'メインコンテンツへ移動' })
    expect(skipLink).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
    // The HashRouter route is untouched: the RNG page is still rendered.
    expect(screen.getByText('RNG画面')).toBeInTheDocument()
  })

  it('opens the mobile Drawer from the hamburger button, reaching every primary screen in the same order', async () => {
    const user = userEvent.setup()
    renderAppLayout('/')

    const openButton = screen.getByRole('button', { name: 'ナビゲーションを開く' })
    await user.click(openButton)

    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    for (const label of primaryScreens) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(navigationSequence(nav)).toEqual(expectedSequence)
    expect(within(nav).queryByRole('link', { name: 'デバッグ' })).not.toBeInTheDocument()
    expect(getComputedStyle(nav).width).not.toBe('240px')
  })

  it('shows デバッグ in the mobile Drawer too once Debug Mode is on', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({ debugMode: true })
    renderAppLayout('/')

    await user.click(screen.getByRole('button', { name: 'ナビゲーションを開く' }))
    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(navigationSequence(nav)).toEqual([...expectedSequence, 'デバッグ'])
  })

  it('navigates from the mobile Drawer and closes it', async () => {
    const user = userEvent.setup()
    renderAppLayout('/')

    await user.click(screen.getByRole('button', { name: 'ナビゲーションを開く' }))
    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    await user.click(within(nav).getByRole('link', { name: '通常アーティアカウンター' }))

    expect(screen.getByText('通常カウンター画面')).toBeInTheDocument()
    // The AppBar is hidden from the accessibility tree while the modal Drawer
    // is still closing; it is back once the Drawer has closed.
    await waitFor(() =>
      expect(within(screen.getByRole('banner')).getByText('通常アーティアカウンター')).toBeInTheDocument(),
    )
  })
})
