/**
 * Heading levels a nested presentation section may take.
 *
 * `h1` is reserved for the page title (`PageShell`), so embedded sections
 * start at `h2`. `nextHeadingLevel()` lets a component that is embedded at a
 * caller-chosen level derive the level of its own sub-sections, keeping the
 * page outline sequential wherever it is placed. `h6` has no deeper level and
 * is returned unchanged.
 */
export type SectionHeadingLevel = 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

export function nextHeadingLevel(level: SectionHeadingLevel): SectionHeadingLevel {
  switch (level) {
    case 'h2':
      return 'h3'
    case 'h3':
      return 'h4'
    case 'h4':
      return 'h5'
    default:
      return 'h6'
  }
}
