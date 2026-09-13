import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import { appTheme } from '../app/theme'
import { hasMaxHeightRule } from '../test/cssRuleAssertions'
import { DialogFormError } from './DialogFormError'

const longMessage = Array.from(
  { length: 12 },
  (_, index) => `restorationBonuses[${index}]: 選択した武器種では利用できないボーナス／Rankです。`,
).join(' / ')

describe('DialogFormError', () => {
  it('keeps the full message in an error alert inside a bounded, scrollable region', () => {
    render(
      <ThemeProvider theme={appTheme}>
        <DialogFormError message={longMessage} />
      </ThemeProvider>,
    )

    const alert = screen.getByRole('alert')
    // Nothing is truncated: the whole text is present.
    expect(alert).toHaveTextContent(longMessage)
    // The region is bounded and scrolls instead of growing without limit.
    // jsdom resolves `overflow-y` but not a `min()` max-height, so the bound
    // is asserted on the authored rule of the alert's own class.
    expect(getComputedStyle(alert).overflowY).toBe('auto')
    expect(hasMaxHeightRule(alert)).toBe(true)
    // The scrolling text is reachable from the keyboard, but nothing is
    // focused automatically.
    expect(screen.getByText(longMessage)).toHaveAttribute('tabindex', '0')
    expect(document.activeElement).toBe(document.body)
  })
})
