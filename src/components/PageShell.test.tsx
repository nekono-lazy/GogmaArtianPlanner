import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageShell } from './PageShell'

describe('PageShell', () => {
  it('renders the title as a level-1 heading and the description as text', () => {
    render(<PageShell title="テストタイトル" description="テスト説明文" />)

    const heading = screen.getByRole('heading', { level: 1, name: 'テストタイトル' })
    expect(heading).toBeInTheDocument()
    expect(screen.getByText('テスト説明文')).toBeInTheDocument()
  })

  it('renders the fallback message when no children are given', () => {
    render(<PageShell title="タイトル" description="説明" />)

    expect(
      screen.getByText('この画面の機能は、今後の実装タスクで追加します。'),
    ).toBeInTheDocument()
  })

  it('renders children instead of the fallback message when provided', () => {
    render(
      <PageShell title="タイトル" description="説明">
        <div>実際の画面内容</div>
      </PageShell>,
    )

    expect(screen.getByText('実際の画面内容')).toBeInTheDocument()
    expect(
      screen.queryByText('この画面の機能は、今後の実装タスクで追加します。'),
    ).not.toBeInTheDocument()
  })

  it('renders actions when provided, and nothing extra when omitted', () => {
    const { rerender } = render(<PageShell title="タイトル" description="説明" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(
      <PageShell
        title="タイトル"
        description="説明"
        actions={<button type="button">保存</button>}
      >
        <div>本文</div>
      </PageShell>,
    )

    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
  })
})
