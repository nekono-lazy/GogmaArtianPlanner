import { useState } from 'react'
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

  it('keeps the title as the name of the toggle, the heading and the region while the summary describes it', async () => {
    const user = userEvent.setup()
    render(
      <DisclosureAccordion
        title="目標A"
        headingLevel="h3"
        titleVariant="h3"
        summary={<span>大剣 / 火属性 要整理</span>}
      >
        <p>内容</p>
      </DisclosureAccordion>,
    )

    const toggle = screen.getByRole('button', { name: '目標A' })
    expect(toggle).toHaveAccessibleDescription('大剣 / 火属性 要整理')
    expect(screen.getByRole('heading', { level: 3, name: '目標A' })).toContainElement(toggle)
    await user.click(toggle)
    expect(screen.getByRole('region', { name: '目標A' })).toHaveAttribute('id', toggle.getAttribute('aria-controls'))
  })

  it('follows the caller-owned open state when controlled', async () => {
    const user = userEvent.setup()
    function Controlled() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>外から開く</button>
          <DisclosureAccordion title="グループ" headingLevel="h3" expanded={open} onExpandedChange={setOpen} unmountOnExit>
            <p>中身</p>
          </DisclosureAccordion>
        </>
      )
    }
    render(<Controlled />)

    const toggle = screen.getByRole('button', { name: 'グループ' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: '外から開く' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('中身')).toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})
