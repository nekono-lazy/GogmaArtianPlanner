import { useId, type ReactNode } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, SvgIcon, Typography } from '@mui/material'

export type DisclosureHeadingLevel = 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

function ExpandIcon() {
  return (
    <SvgIcon aria-hidden="true">
      <path d="M7 10l5 5 5-5z" />
    </SvgIcon>
  )
}

/**
 * A progressive-disclosure section with correct heading semantics.
 *
 * The Accordion's own heading slot is the single heading authority around the
 * toggle, at the level the caller chooses for its place in the page outline;
 * the summary text is rendered as a `span` so no nested heading is created.
 * The summary keeps a 48px minimum height as a comfortable touch target.
 *
 * ARIA wiring follows MUI's contract: the summary's `id` and `aria-controls`
 * are the authority, and the Accordion derives its content region's `id` and
 * `aria-labelledby` from them. Both ids are generated here with `useId`, so
 * every instance is unique and no id is ever placed on two elements; callers
 * never supply ids.
 *
 * `unmountOnExit` keeps heavy content (long route traces) out of the DOM while
 * the panel is closed.
 *
 * `headingLevel: 'none'` is for a disclosure nested below an `h6`: HTML has no
 * deeper heading, so the toggle keeps its full ARIA wiring but sits in a plain
 * `div` instead of repeating the parent's level as a false sibling heading.
 */
export function DisclosureAccordion({
  title,
  headingLevel,
  children,
  unmountOnExit = false,
}: {
  title: string
  headingLevel: DisclosureHeadingLevel | 'none'
  children: ReactNode
  unmountOnExit?: boolean
}) {
  const baseId = useId()
  const summaryId = `${baseId}-summary`
  const contentId = `${baseId}-content`
  return (
    <Accordion
      slotProps={{
        heading: { component: headingLevel === 'none' ? 'div' : headingLevel },
        transition: { unmountOnExit },
      }}
    >
      <AccordionSummary
        id={summaryId}
        aria-controls={contentId}
        expandIcon={<ExpandIcon />}
        sx={{ minHeight: 48, '& .MuiAccordionSummary-content': { minWidth: 0 } }}
      >
        <Typography component="span" variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  )
}
