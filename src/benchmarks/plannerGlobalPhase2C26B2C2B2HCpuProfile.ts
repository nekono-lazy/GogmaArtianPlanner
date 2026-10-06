/**
 * Issue #154 Phase 2-C2.6-B2-C2B2H: the structure of the CPU profile attribution, fixed before the formal run. Research only.
 * Never import from Production.
 *
 * It names the Repository functions a `state_generation` sample can be attributed to (the code under measurement, read from the
 * measured HEAD's source text), derives their source spans and the `state_generation` block of `generateReservedDepth()` from that
 * text, and resolves V8 CPU profile call frames to them through the child's script table (A5's source-map table). It holds no
 * expected hotspot, share or category of any run: the runner's profiler probe uses it to prove the frames resolve before a formal
 * Search starts, and the post-hoc analysis classifies with it.
 */
import { normalizePhase2C26A5Url, type CpuProfileCallFrame, type Phase2C26A5ScriptTable } from './plannerGlobalPhase2C26A5Analysis'

export class Phase2C26B2C2B2HProfileStructureError extends Error {}

// ---------------------------------------------------------------- the registered functions

/**
 * The role a registered function plays in `state_generation` (`generateReservedDepth()` between the `state_generation` start and
 * completion boundaries):
 *
 * - `owner`: `generateReservedDepth` itself (the sorted position loop, the Reset parent `find`, the position x frontier Keep scan,
 *   `windows[index].has`, array iteration / push and whatever V8 inlines into it);
 * - `reset_prediction` / `keep_prediction`: functions on only the Reset / only the Keep prediction path (the memoized
 *   `predictReset` / `predictKeep` closures and the Production RNG functions only that operation reaches);
 * - `prediction_shared`: Production RNG functions both operations reach (`predictGogmaBonus`, seed normalization, support
 *   re-check, the reference block / slot draw);
 * - `counter_advance`: `advanceGogmaCounter` and its validation;
 * - `state_construction`: `reservedGeneratedState` and the Keep family layout key it computes for every generated state;
 * - `checkpoint`: `SearchExecutionContext.checkpoint` (its cancellation check and counter; the Research yield it awaits is not CPU).
 */
export type Phase2C26B2C2B2HRole = 'owner' | 'reset_prediction' | 'keep_prediction' | 'prediction_shared' | 'counter_advance' | 'state_construction' | 'checkpoint'

/** How the function is declared (the span derivation needs it): `function name(`, a class method `name(`, or a property arrow `name: (...) => {`. */
export type Phase2C26B2C2B2HDeclaration = 'function' | 'method' | 'property_arrow'

export interface Phase2C26B2C2B2HRegistryEntry {
  role: Phase2C26B2C2B2HRole
  file: string
  functionName: string
  declaration: Phase2C26B2C2B2HDeclaration
  /** Attribute an anonymous frame whose source-mapped start lies in the span (its closures, e.g. the `find` / `sort` callbacks). */
  anonymousBySpan: boolean
}

const BONUS = 'src/domain/search/bonusStream.ts'
const EXECUTION = 'src/domain/search/searchExecution.ts'
const ENGINE = 'src/domain/rng/production/productionRngEngine.ts'
const PREDICTION = 'src/domain/rng/production/gogmaPrediction.ts'
const GAME_GOGMA = 'src/domain/rng/production/gameGogmaBonuses.ts'
const FAMILY = 'src/domain/rng/gogmaBonusFamily.ts'

/** The registered functions (fixed before the formal run; never changed after seeing a result). */
export const PHASE2C26B2C2B2H_FUNCTION_REGISTRY: readonly Phase2C26B2C2B2HRegistryEntry[] = [
  { role: 'owner', file: BONUS, functionName: 'generateReservedDepth', declaration: 'function', anonymousBySpan: true },
  { role: 'reset_prediction', file: BONUS, functionName: 'predictReset', declaration: 'function', anonymousBySpan: false },
  { role: 'reset_prediction', file: PREDICTION, functionName: 'predictProductionGogmaReset', declaration: 'function', anonymousBySpan: false },
  { role: 'reset_prediction', file: PREDICTION, functionName: 'predictProductionGogmaResetSlotsFromRawValues', declaration: 'function', anonymousBySpan: false },
  { role: 'reset_prediction', file: GAME_GOGMA, functionName: 'productionGogmaResetCandidatesForWeaponAndElement', declaration: 'function', anonymousBySpan: true },
  { role: 'reset_prediction', file: GAME_GOGMA, functionName: 'buildProductionWeightedGogmaResetPool', declaration: 'function', anonymousBySpan: true },
  { role: 'keep_prediction', file: BONUS, functionName: 'predictKeep', declaration: 'function', anonymousBySpan: false },
  { role: 'keep_prediction', file: PREDICTION, functionName: 'predictReferenceGogmaKeep', declaration: 'function', anonymousBySpan: true },
  { role: 'keep_prediction', file: PREDICTION, functionName: 'requireReferenceKeepFamily', declaration: 'function', anonymousBySpan: false },
  { role: 'keep_prediction', file: ENGINE, functionName: 'hasKeepMaster', declaration: 'function', anonymousBySpan: false },
  { role: 'keep_prediction', file: ENGINE, functionName: 'hasUnreadableKeepFamily', declaration: 'function', anonymousBySpan: true },
  { role: 'keep_prediction', file: GAME_GOGMA, functionName: 'keepCurrentBonusFamily', declaration: 'function', anonymousBySpan: false },
  { role: 'keep_prediction', file: GAME_GOGMA, functionName: 'toReferenceKeepCurrentBonus', declaration: 'function', anonymousBySpan: false },
  { role: 'keep_prediction', file: GAME_GOGMA, functionName: 'toReferenceKeepCurrentBonuses', declaration: 'function', anonymousBySpan: false },
  { role: 'prediction_shared', file: ENGINE, functionName: 'predictGogmaBonus', declaration: 'method', anonymousBySpan: false },
  { role: 'prediction_shared', file: ENGINE, functionName: 'getPredictionSupport', declaration: 'method', anonymousBySpan: false },
  { role: 'prediction_shared', file: ENGINE, functionName: 'requireSupport', declaration: 'function', anonymousBySpan: false },
  { role: 'prediction_shared', file: ENGINE, functionName: 'normalizedBaseSeed', declaration: 'function', anonymousBySpan: false },
  { role: 'prediction_shared', file: PREDICTION, functionName: 'referenceGogmaBlock', declaration: 'function', anonymousBySpan: false },
  { role: 'prediction_shared', file: PREDICTION, functionName: 'predictReferenceGogmaSlots', declaration: 'function', anonymousBySpan: false },
  { role: 'prediction_shared', file: PREDICTION, functionName: 'requireNonNegativeSafeInteger', declaration: 'function', anonymousBySpan: false },
  { role: 'counter_advance', file: ENGINE, functionName: 'advanceGogmaCounter', declaration: 'method', anonymousBySpan: false },
  { role: 'counter_advance', file: ENGINE, functionName: 'advanceOneCounter', declaration: 'function', anonymousBySpan: false },
  { role: 'counter_advance', file: ENGINE, functionName: 'validateCounter', declaration: 'function', anonymousBySpan: false },
  { role: 'state_construction', file: BONUS, functionName: 'reservedGeneratedState', declaration: 'function', anonymousBySpan: false },
  { role: 'state_construction', file: FAMILY, functionName: 'keepFamilyLayoutKey', declaration: 'function', anonymousBySpan: true },
  { role: 'state_construction', file: FAMILY, functionName: 'keepFamilyLayout', declaration: 'function', anonymousBySpan: true },
  { role: 'state_construction', file: FAMILY, functionName: 'keepFamilyOfBonus', declaration: 'function', anonymousBySpan: false },
  { role: 'state_construction', file: FAMILY, functionName: 'keepFamilyBonusTypeId', declaration: 'function', anonymousBySpan: true },
  { role: 'checkpoint', file: EXECUTION, functionName: 'checkpoint', declaration: 'property_arrow', anonymousBySpan: true },
]

/** The Repository source files whose frames the classification needs; each must have a source map in the profiled child. */
export const PHASE2C26B2C2B2H_REQUIRED_SOURCE_FILES: readonly string[] = [...new Set(PHASE2C26B2C2B2H_FUNCTION_REGISTRY.map(entry => entry.file))]

/** Production RNG files: a frame of one without a registered role (or an operation-specific ancestor) is shared prediction work. */
export const PHASE2C26B2C2B2H_PREDICTION_DIRECTORY = 'src/domain/rng/production/'

export interface Phase2C26B2C2B2HFunctionSpan { file: string; functionName: string; startLine: number; endLine: number; indent: number }

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function declarationPattern(entry: Pick<Phase2C26B2C2B2HRegistryEntry, 'functionName' | 'declaration'>): RegExp {
  const name = escapeRegExp(entry.functionName)
  switch (entry.declaration) {
    case 'function': return new RegExp(`^(\\s*)(export\\s+)?(async\\s+)?function\\s+${name}\\s*[<(]`)
    case 'method': return new RegExp(`^(\\s+)(async\\s+)?${name}\\s*\\(`)
    case 'property_arrow': return new RegExp(`^(\\s*)${name}:\\s*(async\\s+)?\\([^)]*\\)\\s*=>\\s*\\{\\s*$`)
  }
}

const braceBalance = (line: string) => (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0)

/**
 * The 1-based source span of each registered function from the measured HEAD's source text: the unique declaration line (the
 * registered declaration kind, any indentation) through the first following line that is exactly the declaration's indentation
 * plus `}` (a property arrow may end `},`); a declaration line that opens and closes its own body (`name(...) { ... }`) is a
 * one-line span. Fails closed when a declaration is missing, ambiguous or unterminated.
 */
export function derivePhase2C26B2C2B2HFunctionSpans(sources: Readonly<Record<string, string>>,
  registry: readonly Pick<Phase2C26B2C2B2HRegistryEntry, 'file' | 'functionName' | 'declaration'>[] = PHASE2C26B2C2B2H_FUNCTION_REGISTRY): Phase2C26B2C2B2HFunctionSpan[] {
  return registry.map(entry => {
    const text = sources[entry.file]
    if (typeof text !== 'string') throw new Phase2C26B2C2B2HProfileStructureError(`No source text for ${entry.file}.`)
    const lines = text.split(/\r?\n/)
    const pattern = declarationPattern(entry)
    const starts = lines.flatMap((line, index) => (pattern.test(line) ? [index] : []))
    if (starts.length !== 1) throw new Phase2C26B2C2B2HProfileStructureError(`${entry.file}: ${starts.length} declarations of ${entry.functionName}.`)
    const start = starts[0]!
    const indent = (pattern.exec(lines[start]!) as RegExpExecArray)[1]!
    const line = lines[start]!
    if (line.includes('{') && braceBalance(line) === 0 && /\}\s*$/.test(line)) {
      return { file: entry.file, functionName: entry.functionName, startLine: start + 1, endLine: start + 1, indent: indent.length }
    }
    const close = new RegExp(`^${escapeRegExp(indent)}\\}${entry.declaration === 'property_arrow' ? ',?' : ''}\\s*$`)
    const end = lines.findIndex((l, index) => index > start && close.test(l))
    if (end < 0) throw new Phase2C26B2C2B2HProfileStructureError(`${entry.file}: ${entry.functionName} is not terminated by "${indent}}".`)
    return { file: entry.file, functionName: entry.functionName, startLine: start + 1, endLine: end + 1, indent: indent.length }
  })
}

// ---------------------------------------------------------------- the state_generation block of generateReservedDepth

export const PHASE2C26B2C2B2H_BLOCK_MARKERS = {
  file: BONUS,
  functionName: 'generateReservedDepth',
  started: "runtime.phase('phase_started', 'state_generation')",
  completed: "runtime.phase('phase_completed', 'state_generation')",
} as const

/**
 * The registered sub-blocks of the `state_generation` block, in source order. Each label starts at the first line at or after the
 * previous label's line that contains its marker text and runs to the line before the next label (the last one to the block end);
 * the lines before the first marker are `block_head`. Descriptive only (line ticks), never a decision input.
 */
export const PHASE2C26B2C2B2H_SUB_BLOCK_MARKERS: readonly { label: string; marker: string }[] = [
  { label: 'sorted_position_loop', marker: 'for (const position of [...positions].sort(' },
  { label: 'reset_branch', marker: 'if (resetAllowed) {' },
  { label: 'reset_parent_lookup', marker: 'const parent = depth === 1' },
  { label: 'reset_parent_guard', marker: 'if (parent === undefined) {' },
  { label: 'reset_checkpoint', marker: 'await execution.checkpoint()' },
  { label: 'reset_prediction', marker: 'predictReset(position)' },
  { label: 'reset_counter_advance', marker: "engine.advanceGogmaCounter(position, { type: 'reset_bonuses' })" },
  { label: 'reset_state_construction', marker: 'generated.push(reservedGeneratedState(depth, depth,' },
  { label: 'frontier_scan', marker: 'for (const [index, state] of set.frontier.entries()) {' },
  { label: 'keep_eligibility_windows_has', marker: '!windows[index].has(position)' },
  { label: 'keep_checkpoint', marker: 'await execution.checkpoint()' },
  { label: 'keep_prediction', marker: 'predictKeep(position, state.familyLayoutKey, state.bonuses)' },
  { label: 'keep_counter_advance', marker: "engine.advanceGogmaCounter(position, { type: 'keep_bonuses' })" },
  { label: 'keep_state_construction', marker: 'generated.push(reservedGeneratedState(depth, state.lastResetDepth,' },
  { label: 'generation_end', marker: 'runtime.counts.generatedStates = generated.length' },
]

export interface Phase2C26B2C2B2HBlock {
  file: string
  /** 1-based: the first line after the start boundary through the completion boundary. */
  startLine: number
  endLine: number
  lines: { line: number; text: string; label: string }[]
  subBlocks: { label: string; startLine: number; endLine: number }[]
}

/** Derives the `state_generation` block and its sub-blocks from the measured HEAD's source text; fails closed unless every marker is found in order. */
export function derivePhase2C26B2C2B2HStateGenerationBlock(source: string, markers = PHASE2C26B2C2B2H_BLOCK_MARKERS,
  subMarkers = PHASE2C26B2C2B2H_SUB_BLOCK_MARKERS): Phase2C26B2C2B2HBlock {
  const lines = source.split(/\r?\n/)
  const find = (marker: string) => lines.flatMap((line, index) => (line.includes(marker) ? [index] : []))
  const started = find(markers.started), completed = find(markers.completed)
  if (started.length !== 1 || completed.length !== 1 || completed[0]! <= started[0]!) {
    throw new Phase2C26B2C2B2HProfileStructureError(`${markers.file}: the state_generation markers are not unique and ordered.`)
  }
  const first = started[0]! + 1, last = completed[0]!
  const starts: { label: string; index: number }[] = []
  let from = first
  for (const { label, marker } of subMarkers) {
    const index = lines.findIndex((line, i) => i >= from && i <= last && line.includes(marker))
    if (index < 0) throw new Phase2C26B2C2B2HProfileStructureError(`${markers.file}: the sub-block marker of ${label} is not found in order inside the state_generation block.`)
    starts.push({ label, index })
    from = index + 1
  }
  const subBlocks = starts.map((s, i) => ({ label: s.label, startLine: s.index + 1, endLine: (i + 1 < starts.length ? starts[i + 1]!.index : last + 1) }))
  const labelOf = (index: number) => [...starts].reverse().find(s => s.index <= index)?.label ?? 'block_head'
  const blockLines = lines.slice(first, last + 1).map((text, offset) => ({ line: first + 1 + offset, text: text.trim(), label: labelOf(first + offset) }))
  if (starts[0]!.index > first) subBlocks.unshift({ label: 'block_head', startLine: first + 1, endLine: starts[0]!.index })
  return { file: markers.file, startLine: first + 1, endLine: last + 1, lines: blockLines, subBlocks }
}

// ---------------------------------------------------------------- frames

export type Phase2C26B2C2B2HFrameKind = 'gc' | 'program' | 'idle' | 'root' | 'vite_module_runner' | 'vite_ssr_unmapped' | 'research_harness' | 'repository' | 'dependency'
  | 'node_internal' | 'native'

export interface Phase2C26B2C2B2HFrame {
  functionName: string
  file: string
  /** 1-based source-mapped line of the function start (Repository frames with a source map), else null. */
  originalLine: number | null
  registered: string | null
  role: Phase2C26B2C2B2HRole | null
  /** Whether a registered frame was matched by name (false: an anonymous frame by span). */
  byName: boolean
  kind: Phase2C26B2C2B2HFrameKind
}

/** A frame url normalized to a Repository-relative path (`src/...`, `scripts/<runner>.mjs`), a dependency path, or the raw value. */
export function normalizePhase2C26B2C2B2HUrl(url: string): string {
  const value = normalizePhase2C26A5Url(url)
  if (value.startsWith('src/') || value.includes('node_modules/')) return value
  const script = /(?:^|\/)(scripts\/[^/]+\.m?[jt]s)$/.exec(value)
  return script ? script[1]! : value
}

function kindOf(functionName: string, rawUrl: string, file: string, originalLine: number | null): Phase2C26B2C2B2HFrameKind {
  if (functionName === '(garbage collector)') return 'gc'
  if (functionName === '(program)') return 'program'
  if (functionName === '(idle)') return 'idle'
  if (functionName === '(root)') return 'root'
  if (file.includes('vite/dist/node/module-runner') || file.includes('vite/dist/node/chunks')) return 'vite_module_runner'
  if (file.startsWith('src/benchmarks/') || file.startsWith('scripts/')) return 'research_harness'
  if (file.startsWith('src/')) return originalLine === null ? 'vite_ssr_unmapped' : 'repository'
  if (file.startsWith('node_modules/') || file.includes('/node_modules/')) return 'dependency'
  if (rawUrl.startsWith('node:')) return 'node_internal'
  return 'native'
}

/** Resolves one call frame to its Repository file, source-mapped function start and registered function. */
export function resolvePhase2C26B2C2B2HFrame(callFrame: CpuProfileCallFrame, scripts: Phase2C26A5ScriptTable, spans: readonly Phase2C26B2C2B2HFunctionSpan[],
  registry: readonly Phase2C26B2C2B2HRegistryEntry[] = PHASE2C26B2C2B2H_FUNCTION_REGISTRY): Phase2C26B2C2B2HFrame {
  const rawUrl = callFrame.url !== '' ? callFrame.url : (scripts.urlOf(callFrame.scriptId) ?? '')
  const file = normalizePhase2C26B2C2B2HUrl(rawUrl)
  const repository = file.startsWith('src/')
  const originalLine = repository ? scripts.originalLine(callFrame.scriptId, callFrame.lineNumber, callFrame.columnNumber) : null
  let registered: string | null = null, role: Phase2C26B2C2B2HRole | null = null, byName = false
  if (repository) {
    for (const entry of registry) {
      if (entry.file !== file) continue
      const span = spans.find(s => s.file === entry.file && s.functionName === entry.functionName)
      const named = callFrame.functionName === entry.functionName
      const bySpan = entry.anonymousBySpan && callFrame.functionName === '' && span !== undefined && originalLine !== null
        && originalLine >= span.startLine && originalLine <= span.endLine
      if (named || bySpan) { registered = `${entry.file}#${entry.functionName}`; role = entry.role; byName = named; break }
    }
  }
  return { functionName: callFrame.functionName, file, originalLine, registered, role, byName, kind: kindOf(callFrame.functionName, rawUrl, file, originalLine) }
}

export const phase2c26b2c2b2hFrameLabel = (f: Phase2C26B2C2B2HFrame) => `${f.functionName || '(anonymous)'}@${f.file || '-'}${f.originalLine === null ? '' : `:${f.originalLine}`}`
