import { Card, Paper } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { appTheme, createAppTheme, type ThemeMode } from './theme'

/** WCAG relative luminance contrast of two `#rrggbb` colours. */
function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((offset) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('createAppTheme', () => {
  it.each<ThemeMode>(['light', 'dark'])('builds the %s palette mode', (mode) => {
    expect(createAppTheme(mode).palette.mode).toBe(mode)
  })

  it.each<ThemeMode>(['light', 'dark'])('defines every main palette token in %s', (mode) => {
    const { palette } = createAppTheme(mode)
    for (const token of [
      palette.background.default,
      palette.background.paper,
      palette.text.primary,
      palette.text.secondary,
      palette.divider,
      palette.primary.main,
      palette.secondary.main,
      palette.success.main,
      palette.warning.main,
      palette.error.main,
      palette.info.main,
    ]) {
      expect(token).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('keeps the Light palette exactly as before Dark was added', () => {
    const { palette } = createAppTheme('light')
    expect(palette.primary.main).toBe('#394f46')
    expect(palette.secondary.main).toBe('#8a5a33')
    expect(palette.background).toMatchObject({ default: '#f5f5f1', paper: '#ffffff' })
    expect(palette.text).toMatchObject({ primary: '#1c1f1d', secondary: '#5b615d' })
    expect(palette.divider).toBe('#dfe2dc')
  })

  it('keeps `appTheme` as the Light theme', () => {
    expect(appTheme.palette.mode).toBe('light')
    expect(appTheme.palette.primary.main).toBe(createAppTheme('light').palette.primary.main)
  })

  it('gives Dark its own readable brand colours instead of reusing the Light ones', () => {
    const { palette } = createAppTheme('dark')
    expect(palette.primary.main).not.toBe('#394f46')
    expect(palette.secondary.main).not.toBe('#8a5a33')
    for (const surface of [palette.background.default, palette.background.paper]) {
      for (const text of [
        palette.text.primary,
        palette.text.secondary,
        palette.primary.main,
        palette.secondary.main,
        palette.success.main,
        palette.warning.main,
        palette.error.main,
        palette.info.main,
      ]) {
        expect([text, surface, contrast(text, surface) >= 4.5]).toEqual([text, surface, true])
      }
    }
    expect(contrast(palette.primary.contrastText, palette.primary.main)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.secondary.contrastText, palette.secondary.main)).toBeGreaterThanOrEqual(4.5)
  })

  it('shares typography, shape and component defaults across modes', () => {
    const light = createAppTheme('light')
    const dark = createAppTheme('dark')
    for (const variant of ['h1', 'h2', 'h3', 'subtitle1', 'body1', 'body2', 'button', 'caption'] as const) {
      expect(dark.typography[variant]).toEqual(light.typography[variant])
    }
    expect(dark.typography.fontFamily).toBe(light.typography.fontFamily)
    expect(dark.shape).toEqual(light.shape)
    expect(Object.keys(dark.components ?? {})).toEqual(Object.keys(light.components ?? {}))
  })
})

describe('elevated surfaces', () => {
  function renderSurfaces(mode: ThemeMode) {
    render(
      <ThemeProvider theme={createAppTheme(mode)}>
        <Paper elevation={8} data-testid="raised">raised</Paper>
        <Paper variant="outlined" data-testid="outlined">outlined</Paper>
        <Paper elevation={0} data-testid="flat">flat</Paper>
        <Card data-testid="card">card</Card>
      </ThemeProvider>,
    )
    return (id: string) => getComputedStyle(screen.getByTestId(id))
  }

  it('drops the white elevation overlay in Dark and separates a raised surface by a divider border', () => {
    const style = renderSurfaces('dark')
    const { palette } = createAppTheme('dark')
    expect(style('raised').backgroundImage).toBe('none')
    expect(style('raised').borderTopStyle).toBe('solid')
    expect(style('raised').borderTopWidth).toBe('1px')
    // An outlined Paper / Card and a flat Paper keep their own look.
    expect(style('flat').borderTopStyle).not.toBe('solid')
    for (const id of ['outlined', 'card']) expect(style(id).borderTopWidth).toBe('1px')
    expect(palette.divider).toBe('#343b37')
  })

  it('leaves Light elevation exactly as MUI draws it', () => {
    const style = renderSurfaces('light')
    expect(style('raised').borderTopStyle).not.toBe('solid')
  })
})
