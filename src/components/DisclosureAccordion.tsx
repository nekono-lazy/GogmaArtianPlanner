import type { ReactNode } from 'react'
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
 * `unmountOnExit` keeps heavy content (long route traces) out of the DOM while
 * the panel is closed.
 */
export function DisclosureAccordion({
  title,
  headingLevel,
  children,
  unmountOnExit = false,
  detailsId,
}: {
  title: string
  headingLevel: DisclosureHeadingLevel
  children: ReactNode
  unmountOnExit?: boolean
  detailsId?: string
}) {
  return (
    <Accordion
      slotProps={{
        heading: { component: headingLevel },
        transition: { unmountOnExit },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandIcon />}
        aria-controls={detailsId}
        sx={{ minHeight: 48, '& .MuiAccordionSummary-content': { minWidth: 0 } }}
      >
        <Typography component="span" variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails id={detailsId}>{children}</AccordionDetails>
    </Accordion>
  )
}
