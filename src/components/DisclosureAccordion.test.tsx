import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DisclosureAccordion } from './DisclosureAccordion'

describe('DisclosureAccordion', () => {
  it('wires the toggle and its content region with unique ids at the requested heading level', () => {
    render(
      <>
        <DisclosureAccordion title="詳細A" headingLevel="h3">
          <p>内容A</p>
        </DisclosureAccordion>
        <DisclosureAccordion title="詳細B" headingLevel="h3">
          <p>内容B</p>
        </DisclosureAccordion>
      </>,
    )

    const toggleA = screen.getByRole('button', { name: '詳細A' })
    const toggleB = screen.getByRole('button', { name: '詳細B' })
    expect(screen.getByRole('heading', { level: 3, name: '詳細A' })).toContainElement(toggleA)
    expect(toggleA).toHaveAttribute('aria-expanded', 'false')

    // Each instance owns a distinct summary id / content id pair, and the
    // region points back at its own summary.
    expect(toggleA.id).not.toBe(toggleB.id)
    expect(toggleA.getAttribute('aria-controls')).not.toBe(toggleB.getAttribute('aria-controls'))
    const regionA = document.getElementById(toggleA.getAttribute('aria-controls') as string)
    expect(regionA).toHaveAttribute('role', 'region')
    expect(regionA).toHaveAttribute('aria-labelledby', toggleA.id)
    expect(document.querySelectorAll(`[id="${toggleA.id}"]`)).toHaveLength(1)
  })

  it('toggles from the keyboard and exposes the expanded state', async () => {
    const user = userEvent.setup()
    render(
      <DisclosureAccordion title="詳細設定" headingLevel="h2" unmountOnExit>
        <label>
          上限
          <input type="number" defaultValue={1} />
        </label>
      </DisclosureAccordion>,
    )

    const toggle = screen.getByRole('button', { name: '詳細設定' })
    expect(screen.queryByRole('spinbutton', { name: '上限' })).not.toBeInTheDocument()

    await user.tab()
    expect(toggle).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('spinbutton', { name: '上限' })).toBeInTheDocument()

    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders no heading of its own below h6', () => {
    render(
      <DisclosureAccordion title="その他の到達点" headingLevel="none">
        <p>内容</p>
      </DisclosureAccordion>,
    )

    expect(screen.getByRole('button', { name: 'その他の到達点' })).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
