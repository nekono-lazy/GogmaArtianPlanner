import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appTheme } from '../../app/theme'
import {
  APP_VERSION_CHECK_TIMING,
  createAppVersionChecker,
  type AppVersionChecker,
} from '../../services/appVersion/appVersionChecker'
import { AppUpdateNotice } from './AppUpdateNotice'

const CURRENT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const LATEST = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function renderNotice(checker: AppVersionChecker, reload = vi.fn(), strict = false) {
  const notice = (
    <ThemeProvider theme={appTheme}>
      <AppUpdateNotice dependencies={{ checker, reload }} />
    </ThemeProvider>
  )
  render(strict ? <StrictMode>{notice}</StrictMode> : notice)
  return reload
}

/** Lets the startup check's promise settle and React re-render. */
async function flushChecks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('AppUpdateNotice', () => {
  it('shows nothing while the running build is the latest', async () => {
    const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId: async () => CURRENT })
    renderNotice(checker)
    await flushChecks()
    expect(screen.queryByText('新しいバージョンが公開されています')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '再読み込み' })).not.toBeInTheDocument()
  })

  it('shows a persistent status notice with a reload button once a newer build is found', async () => {
    const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId: async () => LATEST })
    const reload = renderNotice(checker)
    await flushChecks()
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('新しいバージョンが公開されています')
    expect(notice).toHaveTextContent('ページを再読み込みしてください')
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument()
    // No close control: the notice stays until the page reloads.
    expect(screen.queryByRole('button', { name: /閉じる|close/i })).not.toBeInTheDocument()
    // Detecting a newer build never reloads by itself.
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads exactly once when 再読み込み is pressed', async () => {
    const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId: async () => LATEST })
    const reload = renderNotice(checker)
    await flushChecks()
    await userEvent.click(screen.getByRole('button', { name: '再読み込み' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('shows nothing and requests nothing without a production build ID', async () => {
    const fetchLatestBuildId = vi.fn(async () => LATEST)
    const checker = createAppVersionChecker({ currentBuildId: null, fetchLatestBuildId })
    renderNotice(checker)
    await flushChecks()
    expect(fetchLatestBuildId).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the notice at once for a checker that already detected an update', async () => {
    const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId: async () => LATEST })
    await checker.check()
    renderNotice(checker)
    expect(screen.getByRole('status')).toHaveTextContent('新しいバージョンが公開されています')
  })

  describe('lifecycle', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: false })
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('makes one request and keeps one interval under StrictMode', async () => {
      const fetchLatestBuildId = vi.fn(async () => CURRENT)
      const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId })
      renderNotice(checker, vi.fn(), true)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(fetchLatestBuildId).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(APP_VERSION_CHECK_TIMING.visibleIntervalMs)
      })
      expect(fetchLatestBuildId).toHaveBeenCalledTimes(2)
    })

    it('keeps the notice after later checks fail', async () => {
      const fetchLatestBuildId = vi
        .fn<() => Promise<string | null>>()
        .mockResolvedValueOnce(LATEST)
        .mockResolvedValue(null)
      const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId })
      renderNotice(checker)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(APP_VERSION_CHECK_TIMING.visibleIntervalMs * 3)
      })
      expect(screen.getByRole('status')).toHaveTextContent('新しいバージョンが公開されています')
    })

    it('clears its listener and timer on unmount', async () => {
      const fetchLatestBuildId = vi.fn(async () => CURRENT)
      const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId })
      const removeSpy = vi.spyOn(document, 'removeEventListener')
      const { unmount } = render(<AppUpdateNotice dependencies={{ checker, reload: vi.fn() }} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      unmount()
      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      expect(vi.getTimerCount()).toBe(0)
      removeSpy.mockRestore()
    })
  })
})
