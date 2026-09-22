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

/** Checks an emitted sx contract, not browser geometry or CSS cascade resolution. */
export function hasStyleRule(
  element: Element,
  property: string,
  value: string,
  media?: string,
): boolean {
  const matches = (rule: CSSRule, currentMedia?: string): boolean => {
    if (rule instanceof CSSStyleRule) {
      return (media === undefined || currentMedia === media)
        && element.matches(rule.selectorText)
        && rule.style.getPropertyValue(property) === value
    }
    if (rule instanceof CSSGroupingRule) {
      const nestedMedia = rule instanceof CSSMediaRule ? rule.conditionText : currentMedia
      return [...rule.cssRules].some((child) => matches(child, nestedMedia))
    }
    return false
  }
  return [...document.styleSheets].some((sheet) => [...sheet.cssRules].some((rule) => matches(rule)))
}
