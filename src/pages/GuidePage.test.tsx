import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { appTheme } from '../app/theme'
import { useSettingsStore } from '../stores/settingsStore'
import { GuidePage } from './GuidePage'

function renderGuide() {
  return render(
    <ThemeProvider theme={appTheme}>
      <MemoryRouter initialEntries={['/guide']}>
        <GuidePage />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

const sectionHeadings = [
  '基本の流れ',
  'まず知っておくこと',
  '1. RNG状態を準備する',
  '必要な場合だけ行う準備',
  '2. 目標武器を登録する',
  '3. 候補を検索する',
  '4. ビルドリストへ追加する',
  '5. 生産計画を作る',
  '6. 実行ナビで作成する',
  'バックアップと復元',
  '困ったとき',
]

describe('GuidePage', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset()
  })

  it('titles the page 使い方 with one h1', () => {
    renderGuide()

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: '使い方' })).toBeInTheDocument()
  })

  it('shows every major section as a labelled h2 region, in order', () => {
    renderGuide()

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(
      sectionHeadings,
    )
    for (const heading of sectionHeadings) {
      expect(screen.getByRole('region', { name: heading })).toBeInTheDocument()
    }
  })

  it('shows the basic flow as an ordered list of six steps', () => {
    renderGuide()

    const flow = screen.getByRole('region', { name: '基本の流れ' })
    const items = within(within(flow).getByRole('list')).getAllByRole('listitem')
    expect(items.map((item) => item.querySelector('p')?.textContent)).toEqual([
      'RNG状態を準備する',
      '目標武器を登録する',
      '候補を検索する',
      'ビルドリストへ追加する',
      '生産計画を作る',
      '実行ナビで作成する',
    ])
  })

  it('treats the Normal Counter and owned weapons as optional preparation', () => {
    renderGuide()

    const optional = screen.getByRole('region', { name: '必要な場合だけ行う準備' })
    expect(within(optional).getByRole('heading', { level: 3, name: '通常アーティアカウンター' })).toBeInTheDocument()
    expect(within(optional).getByRole('heading', { level: 3, name: '所持武器' })).toBeInTheDocument()
    expect(optional).toHaveTextContent('すべての人に必須の手順ではありません')
    expect(optional).toHaveTextContent('14武器種すべてを先に設定する必要はありません')
    expect(optional).toHaveTextContent('登録しなくても使えます')
    // The basic flow never lists either as a mandatory step.
    const flow = screen.getByRole('region', { name: '基本の流れ' })
    expect(flow).not.toHaveTextContent('通常アーティアカウンター')
    expect(flow).not.toHaveTextContent('所持武器')
  })

  it('links to each relevant screen with the right route', () => {
    renderGuide()

    const expected: Array<[string, string]> = [
      ['RNG状態設定を開く', '/rng'],
      ['通常アーティアカウンターを開く', '/normal-counters'],
      ['所持武器を開く', '/owned-weapons'],
      ['目標武器を開く', '/target-weapons'],
      ['候補検索を開く', '/search'],
      ['ビルドリストを開く', '/build-list'],
      ['生産計画の一覧を開く', '/plans'],
      ['設定を開く', '/settings'],
    ]
    for (const [name, href] of expected) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href)
    }
    expect(screen.getAllByRole('link')).toHaveLength(expected.length)
  })

  it('gives every screenshot a meaningful alt text, reserved dimensions and lazy loading below the fold', () => {
    renderGuide()

    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(10)
    const alts = images.map((image) => image.getAttribute('alt') ?? '')
    for (const alt of alts) {
      expect(alt.length).toBeGreaterThan(20)
    }
    expect(new Set(alts).size).toBe(alts.length)
    for (const image of images) {
      expect(Number(image.getAttribute('width'))).toBeGreaterThan(0)
      expect(Number(image.getAttribute('height'))).toBeGreaterThan(0)
      expect(image.getAttribute('src')).toMatch(/\.webp/)
    }
    expect(images[0]).toHaveAttribute('loading', 'eager')
    for (const image of images.slice(1)) {
      expect(image).toHaveAttribute('loading', 'lazy')
    }
  })

  it('does not repeat an image alt text as a visible caption', () => {
    const { container } = renderGuide()

    expect(container.querySelector('figcaption')).toBeNull()
    for (const image of screen.getAllByRole('img')) {
      expect(screen.queryByText(image.getAttribute('alt') ?? '')).toBeNull()
    }
  })

  it('shows the same content whether Debug Mode is on or off', () => {
    const { container, unmount } = renderGuide()
    const withoutDebug = { text: container.textContent, images: container.querySelectorAll('img').length }
    unmount()

    useSettingsStore.setState({ debugMode: true })
    const { container: debugContainer } = renderGuide()
    expect({ text: debugContainer.textContent, images: debugContainer.querySelectorAll('img').length }).toEqual(
      withoutDebug,
    )
  })

  it('explains that Candidate Search always looks for the Ideal and compromise conditions only offer states on its Route', () => {
    renderGuide()

    const target = screen.getByRole('region', { name: '2. 目標武器を登録する' })
    expect(target).toHaveTextContent('常に理想品への作成ルートを探し')
    expect(target).toHaveTextContent('妥協品を別の候補として探すことはありません')
    expect(target).toHaveTextContent('そのルートの途中で使える状態')
    expect(target).not.toHaveTextContent('指定しなければ理想品だけを探します')

    const search = screen.getByRole('region', { name: '3. 候補を検索する' })
    expect(search).toHaveTextContent('理想候補の作成ルートの途中で使える状態')
  })

  it('explains that Import replaces every saved record', () => {
    renderGuide()

    const backup = screen.getByRole('region', { name: 'バックアップと復元' })
    expect(backup).toHaveTextContent('インポートは全置換です')
    expect(backup).toHaveTextContent('貼り付けた内容を読み込む')
    expect(backup).toHaveTextContent('ファイルから読み込む')
    expect(backup).toHaveTextContent('ファイル出力')
  })
})
