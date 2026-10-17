import { useId } from 'react'
import {
  Alert,
  AlertTitle,
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Stack,
  Typography,
} from '@mui/material'
import { DisclosureAccordion, type DisclosureHeadingLevel } from '../DisclosureAccordion'
import {
  SOURCE_EXCLUSION_BATCH_LABEL,
  SOURCE_EXCLUSION_DESCRIPTION,
  SOURCE_EXCLUSION_HEADING,
  SOURCE_EXCLUSION_RESULT_TITLE,
  SOURCE_EXCLUSION_SINGLE_LABEL,
  sourceExclusionDisclosureTitle,
  sourceExclusionReasonLabel,
  sourceExclusionResultMessage,
  type SearchSourceExclusionDisplay,
} from './sourceExclusionPresentation'

/**
 * 「他の目標武器で使用する所持武器を除外する」 (`docs/UI_FLOW.md` 9.2): one fieldset with a Checkbox per operation,
 * each used by the operation it is named after when that operation starts. Checkboxes rather than Switches: the
 * values are conditions of the next search, never applied immediately. The description stays visible and every
 * Checkbox refers to it. The values are the caller's temporary UI state and are never persisted.
 */
export function SourceExclusionConditionFieldset({
  singleExcludeOtherTargetSources,
  batchExcludeOtherTargetSources,
  onSingleChange,
  onBatchChange,
}: {
  singleExcludeOtherTargetSources: boolean
  batchExcludeOtherTargetSources: boolean
  onSingleChange: (value: boolean) => void
  onBatchChange: (value: boolean) => void
}) {
  const legendId = useId()
  const descriptionId = useId()
  const describedBy = { input: { 'aria-describedby': descriptionId } }
  const labelSx = { m: 0, minHeight: 44, pr: 1, alignItems: 'center', '& .MuiFormControlLabel-label': { overflowWrap: 'anywhere' } }
  return (
    <FormControl component="fieldset" sx={{ display: 'block', minWidth: 0, m: 0 }}>
      <FormLabel
        id={legendId}
        component="legend"
        sx={{ fontWeight: 500, color: 'text.primary', overflowWrap: 'anywhere', '&.Mui-focused': { color: 'text.primary' } }}
      >
        {SOURCE_EXCLUSION_HEADING}
      </FormLabel>
      <Typography id={descriptionId} variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
        {SOURCE_EXCLUSION_DESCRIPTION}
      </Typography>
      {/* Stacked at phone width, side by side once there is room (`docs/UI_FLOW.md` 9.2). */}
      <FormGroup sx={{ mt: 0.5, flexDirection: { xs: 'column', sm: 'row' }, columnGap: 3 }}>
        <FormControlLabel
          sx={labelSx}
          control={
            <Checkbox
              checked={singleExcludeOtherTargetSources}
              onChange={(event) => onSingleChange(event.target.checked)}
              slotProps={describedBy}
            />
          }
          label={SOURCE_EXCLUSION_SINGLE_LABEL}
        />
        <FormControlLabel
          sx={labelSx}
          control={
            <Checkbox
              checked={batchExcludeOtherTargetSources}
              onChange={(event) => onBatchChange(event.target.checked)}
              slotProps={describedBy}
            />
          }
          label={SOURCE_EXCLUSION_BATCH_LABEL}
        />
      </FormGroup>
    </FormControl>
  )
}

/**
 * 「所持武器の除外」 (`docs/UI_FLOW.md` 9.2): the weapons a single search really excluded, each with the reasons recorded
 * when that search's input was prepared. Kept apart from the Candidate Search notices. Shown only when at least one
 * weapon was excluded; internal IDs appear in Debug Mode only.
 */
export function SourceExclusionResultAlert({
  display,
  debugMode = false,
  headingLevel = 'h3',
}: {
  display: SearchSourceExclusionDisplay
  debugMode?: boolean
  headingLevel?: DisclosureHeadingLevel
}) {
  const count = display.excludedWeapons.length
  if (!display.excludeOtherTargetSources || count === 0) return null
  return (
    <Alert severity="info" sx={{ '& .MuiAlert-message': { flex: '1 1 auto', minWidth: 0 } }}>
      <AlertTitle>{SOURCE_EXCLUSION_RESULT_TITLE}</AlertTitle>
      <Stack spacing={1.5} sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {sourceExclusionResultMessage(count)}
        </Typography>
        <DisclosureAccordion title={sourceExclusionDisclosureTitle(count)} headingLevel={headingLevel}>
          <Box component="ul" aria-label="除外した所持武器" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1 }}>
            {display.excludedWeapons.map((weapon, index) => (
              <Box
                component="li"
                key={weapon.ownedWeaponId}
                sx={{ minWidth: 0, borderTop: index === 0 ? 0 : 1, borderColor: 'divider', pt: index === 0 ? 0 : 1 }}
              >
                <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                  {weapon.weaponName}
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {weapon.reasons.map((reason) => (
                    <Typography
                      component="li"
                      variant="body2"
                      color="text.secondary"
                      key={`${reason.kind}:${reason.targetWeaponId}`}
                      sx={{ overflowWrap: 'anywhere' }}
                    >
                      {sourceExclusionReasonLabel(reason)}
                    </Typography>
                  ))}
                </Box>
                {debugMode && (
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere' }}>
                    ownedWeaponId: {weapon.ownedWeaponId}
                    {weapon.reasons.map((reason) => (
                      <Box component="span" key={`${reason.kind}:${reason.targetWeaponId}`} sx={{ display: 'block' }}>
                        {reason.kind}: {reason.targetWeaponId}
                        {reason.buildListEntryIds.length > 0 && ` (${reason.buildListEntryIds.join(', ')})`}
                      </Box>
                    ))}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </DisclosureAccordion>
      </Stack>
    </Alert>
  )
}
