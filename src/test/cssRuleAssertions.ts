/**
 * Test-only helpers that inspect authored stylesheet rules.
 *
 * jsdom resolves simple computed properties such as `overflow-y`, but not a
 * `min()` length, so a responsive `max-height` cannot be read back from
 * `getComputedStyle()`. These helpers look at the emitted rules instead.
 */

/**
 * Whether any stylesheet rule that targets one of the element's own classes
 * declares a `max-height`. Responsive `sx` values are emitted inside `@media`
 * groups, so grouping rules are searched too.
 */
export function hasMaxHeightRule(element: Element): boolean {
  const classSelectors = [...element.classList].map((name) => `.${CSS.escape(name)}`)
  const declaresMaxHeight = (rule: CSSRule): boolean => {
    if (rule instanceof CSSStyleRule) {
      return (
        classSelectors.some((selector) =>
          rule.selectorText.split(',').some((part) => part.trim() === selector),
        ) && rule.style.maxHeight !== ''
      )
    }
    if (rule instanceof CSSGroupingRule) return [...rule.cssRules].some(declaresMaxHeight)
    return false
  }
  return [...document.styleSheets].some((sheet) => [...sheet.cssRules].some(declaresMaxHeight))
}
