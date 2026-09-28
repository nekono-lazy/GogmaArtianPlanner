/**
 * Issue #154 Phase 2-C2.5-C: V8 heap snapshot parsing and retaining-structure analysis, Research only. Never import
 * from Production.
 *
 * Parsing. A `.heapsnapshot` can exceed the longest string V8 can build, so it is read as a stream of text chunks
 * (`createHeapSnapshotStreamParser()`); the numeric `nodes` / `edges` arrays go straight into typed arrays and only the
 * `snapshot` header and the `strings` table become JS values. Unknown sections are skipped. The field layout is never
 * assumed: every field index comes from `snapshot.meta.node_fields` / `node_types` / `edge_fields` / `edge_types`, and a
 * missing field, an inconsistent count, a dangling `to_node` or an incomplete file fails closed.
 *
 * Terminology. No dominator tree is computed here, so nothing is called a retained size:
 * - shallow size       the node's own `self_size`;
 * - reachable size     the summed shallow size of every node reachable from a start set over non-weak edges;
 * - edge-cut size      the summed shallow size of the nodes that are reachable from the synthetic root over non-weak
 *                      edges, and stop being reachable when a given set of edges is removed (what those edges alone keep
 *                      alive, collectively; overlapping edge sets are never summed);
 * - retaining path     one shortest path from the synthetic root (breadth-first over non-weak edges) to a node.
 * "New" nodes are nodes whose snapshot object id is greater than the largest id of the pre-Search baseline snapshot
 * of the same process: V8 keeps object ids stable across snapshots of one process, so they were allocated after the
 * baseline (during the Search).
 */

// ---------------------------------------------------------------- stream parser

export interface ParsedHeapSnapshot {
  header: Record<string, unknown>
  nodes: Uint32Array
  edges: Uint32Array
  strings: string[]
  sections: string[]
}

export class HeapSnapshotFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HeapSnapshotFormatError'
  }
}

class GrowableUint32 {
  private buffer: Uint32Array
  length = 0
  constructor(capacity = 1 << 16) { this.buffer = new Uint32Array(Math.max(16, capacity)) }
  reserve(capacity: number) {
    if (capacity <= this.buffer.length) return
    const next = new Uint32Array(capacity)
    next.set(this.buffer.subarray(0, this.length))
    this.buffer = next
  }
  push(value: number) {
    if (this.length === this.buffer.length) this.reserve(this.buffer.length * 2)
    this.buffer[this.length++] = value
  }
  result(): Uint32Array { return this.buffer.slice(0, this.length) }
}

type ParserMode =
  | 'top_open' | 'top_key_or_end' | 'key' | 'colon' | 'value_start'
  | 'numbers' | 'strings_array' | 'string' | 'capture' | 'skip' | 'skip_scalar' | 'end'

const NUMERIC_SECTIONS = new Set(['nodes', 'edges'])
const isSpace = (code: number) => code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09

/**
 * Incremental parser of the V8 heap snapshot JSON. Push text chunks in order, then `finish()`, which fails closed
 * unless the top-level object was closed and the `snapshot`, `nodes`, `edges` and `strings` sections were all read.
 */
export function createHeapSnapshotStreamParser() {
  let mode: ParserMode = 'top_open'
  let key = ''
  let header: Record<string, unknown> | null = null
  const sections: string[] = []
  const numeric = new Map<string, GrowableUint32>()
  let target: GrowableUint32 | null = null
  let accumulator = 0
  let hasDigits = false
  const strings: string[] = []
  let stringParts: string[] = []
  let stringEscaped = false
  let escapePending = false
  // capture / skip state
  let depth = 0
  let inString = false
  let captureParts: string[] = []
  let capturing = false

  const flushNumber = () => {
    if (!hasDigits) return
    if (accumulator > 0xffffffff) throw new HeapSnapshotFormatError(`A ${key} value exceeds 32 bits.`)
    target!.push(accumulator)
    accumulator = 0
    hasDigits = false
  }

  const finishValue = () => { sections.push(key); mode = 'top_key_or_end' }

  function push(chunk: string): void {
    let i = 0
    const n = chunk.length
    while (i < n) {
      switch (mode) {
        case 'top_open': {
          const c = chunk.charCodeAt(i)
          if (isSpace(c)) { i++; break }
          if (c !== 0x7b) throw new HeapSnapshotFormatError('The snapshot does not start with an object.')
          mode = 'top_key_or_end'; i++; break
        }
        case 'top_key_or_end': {
          const c = chunk.charCodeAt(i)
          if (isSpace(c) || c === 0x2c) { i++; break }
          if (c === 0x22) { mode = 'key'; key = ''; i++; break }
          if (c === 0x7d) { mode = 'end'; i++; break }
          throw new HeapSnapshotFormatError(`Unexpected character ${JSON.stringify(chunk[i])} between top-level sections.`)
        }
        case 'key': {
          const end = chunk.indexOf('"', i)
          const slice = end < 0 ? chunk.slice(i) : chunk.slice(i, end)
          if (slice.includes('\\')) throw new HeapSnapshotFormatError('An escaped top-level key is not supported.')
          key += slice
          if (end < 0) { i = n; break }
          if (sections.includes(key)) throw new HeapSnapshotFormatError(`Section ${key} appears twice.`)
          mode = 'colon'; i = end + 1; break
        }
        case 'colon': {
          const c = chunk.charCodeAt(i)
          if (isSpace(c)) { i++; break }
          if (c !== 0x3a) throw new HeapSnapshotFormatError(`Expected ":" after key ${key}.`)
          mode = 'value_start'; i++; break
        }
        case 'value_start': {
          const c = chunk.charCodeAt(i)
          if (isSpace(c)) { i++; break }
          if (NUMERIC_SECTIONS.has(key)) {
            if (c !== 0x5b) throw new HeapSnapshotFormatError(`Section ${key} is not an array.`)
            target = new GrowableUint32()
            if (header) {
              const count = key === 'nodes' ? header.node_count : header.edge_count
              const meta = header.meta as Record<string, unknown> | undefined
              const fields = key === 'nodes' ? meta?.node_fields : meta?.edge_fields
              if (typeof count === 'number' && Array.isArray(fields)) target.reserve(count * fields.length + 1)
            }
            numeric.set(key, target)
            accumulator = 0; hasDigits = false
            mode = 'numbers'; i++; break
          }
          if (key === 'strings') {
            if (c !== 0x5b) throw new HeapSnapshotFormatError('Section strings is not an array.')
            mode = 'strings_array'; i++; break
          }
          capturing = key === 'snapshot'
          captureParts = []
          if (c === 0x7b || c === 0x5b) {
            depth = 1; inString = false; escapePending = false
            if (capturing) captureParts.push(chunk[i])
            mode = 'skip'; i++; break
          }
          if (capturing) throw new HeapSnapshotFormatError('Section snapshot is not an object.')
          if (c === 0x22) { depth = 0; inString = true; escapePending = false; mode = 'skip'; i++; break }
          mode = 'skip_scalar'; break
        }
        case 'numbers': {
          // Hot loop: digits, separators, and the closing bracket.
          for (; i < n; i++) {
            const c = chunk.charCodeAt(i)
            if (c >= 0x30 && c <= 0x39) { accumulator = accumulator * 10 + (c - 0x30); hasDigits = true; continue }
            if (c === 0x2c || isSpace(c)) { flushNumber(); continue }
            if (c === 0x5d) { flushNumber(); i++; target = null; finishValue(); break }
            throw new HeapSnapshotFormatError(`Unexpected character ${JSON.stringify(chunk[i])} in ${key}.`)
          }
          break
        }
        case 'strings_array': {
          const c = chunk.charCodeAt(i)
          if (isSpace(c) || c === 0x2c) { i++; break }
          if (c === 0x22) { mode = 'string'; stringParts = []; stringEscaped = false; escapePending = false; i++; break }
          if (c === 0x5d) { i++; finishValue(); break }
          throw new HeapSnapshotFormatError(`Unexpected character ${JSON.stringify(chunk[i])} in strings.`)
        }
        case 'string': {
          const start = i
          let closed = false
          for (; i < n; i++) {
            const c = chunk.charCodeAt(i)
            if (escapePending) { escapePending = false; continue }
            if (c === 0x5c) { escapePending = true; stringEscaped = true; continue }
            if (c === 0x22) { closed = true; break }
          }
          stringParts.push(chunk.slice(start, i))
          if (closed) {
            const raw = stringParts.join('')
            strings.push(stringEscaped ? JSON.parse(`"${raw}"`) as string : raw)
            stringParts = []
            mode = 'strings_array'
            i++
          }
          break
        }
        case 'skip': {
          const start = i
          for (; i < n; i++) {
            const c = chunk.charCodeAt(i)
            if (inString) {
              if (escapePending) { escapePending = false; continue }
              if (c === 0x5c) { escapePending = true; continue }
              if (c === 0x22) { inString = false; if (depth === 0) { i++; break } }
              continue
            }
            if (c === 0x22) { inString = true; continue }
            if (c === 0x7b || c === 0x5b) { depth++; continue }
            if (c === 0x7d || c === 0x5d) { depth--; if (depth === 0) { i++; break } }
          }
          if (capturing) captureParts.push(chunk.slice(start, i))
          if (depth === 0 && !inString) {
            if (capturing) {
              let parsed: unknown
              try { parsed = JSON.parse(captureParts.join('')) } catch { throw new HeapSnapshotFormatError('Section snapshot is not valid JSON.') }
              if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new HeapSnapshotFormatError('Section snapshot is not an object.')
              header = parsed as Record<string, unknown>
              capturing = false
              captureParts = []
            }
            finishValue()
          }
          break
        }
        case 'skip_scalar': {
          const c = chunk.charCodeAt(i)
          if (c === 0x2c || c === 0x7d || isSpace(c)) { finishValue(); break }
          i++; break
        }
        case 'end': {
          if (!isSpace(chunk.charCodeAt(i))) throw new HeapSnapshotFormatError('Content after the top-level object.')
          i++; break
        }
      }
    }
  }

  function finish(): ParsedHeapSnapshot {
    if (mode !== 'end') throw new HeapSnapshotFormatError(`The snapshot ended inside ${mode === 'top_open' ? 'nothing' : `section ${key || '(top level)'}`} (incomplete file).`)
    for (const required of ['snapshot', 'nodes', 'edges', 'strings']) {
      if (!sections.includes(required)) throw new HeapSnapshotFormatError(`Section ${required} is missing.`)
    }
    return { header: header!, nodes: numeric.get('nodes')!.result(), edges: numeric.get('edges')!.result(), strings, sections: [...sections] }
  }

  return { push, finish }
}

/** Parses a whole in-memory snapshot text (tests and small files). */
export function parseHeapSnapshotText(textValue: string, chunkSize = 1 << 20): ParsedHeapSnapshot {
  const parser = createHeapSnapshotStreamParser()
  for (let i = 0; i < textValue.length; i += chunkSize) parser.push(textValue.slice(i, i + chunkSize))
  return parser.finish()
}

// ---------------------------------------------------------------- schema

export interface HeapSnapshotSchema {
  nodeFieldCount: number
  edgeFieldCount: number
  nodeType: number
  nodeName: number
  nodeId: number
  nodeSelfSize: number
  nodeEdgeCount: number
  nodeTypes: string[]
  edgeType: number
  edgeNameOrIndex: number
  edgeToNode: number
  edgeTypes: string[]
  nodeCount: number
  edgeCount: number
}

export class HeapSnapshotSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HeapSnapshotSchemaError'
  }
}

function fieldIndex(fields: unknown[], name: string, where: string): number {
  const index = fields.indexOf(name)
  if (index < 0) throw new HeapSnapshotSchemaError(`${where} has no field ${name}.`)
  return index
}

/** Resolves every field position from the snapshot's own meta; fails closed on any mismatch. */
export function resolveHeapSnapshotSchema(parsed: ParsedHeapSnapshot): HeapSnapshotSchema {
  const meta = parsed.header.meta as Record<string, unknown> | undefined
  if (typeof meta !== 'object' || meta === null) throw new HeapSnapshotSchemaError('snapshot.meta is missing.')
  const nodeFields = meta.node_fields, nodeTypesMeta = meta.node_types, edgeFields = meta.edge_fields, edgeTypesMeta = meta.edge_types
  if (!Array.isArray(nodeFields) || !Array.isArray(nodeTypesMeta) || !Array.isArray(edgeFields) || !Array.isArray(edgeTypesMeta)) {
    throw new HeapSnapshotSchemaError('snapshot.meta lacks node_fields / node_types / edge_fields / edge_types.')
  }
  // V8 may list more type descriptors than fields (it does for node_types); every field must have one.
  if (nodeTypesMeta.length < nodeFields.length || edgeTypesMeta.length < edgeFields.length) throw new HeapSnapshotSchemaError('meta lists fewer type descriptors than fields.')
  const nodeType = fieldIndex(nodeFields, 'type', 'node_fields')
  const edgeType = fieldIndex(edgeFields, 'type', 'edge_fields')
  const nodeTypes = nodeTypesMeta[nodeType]
  const edgeTypes = edgeTypesMeta[edgeType]
  if (!Array.isArray(nodeTypes) || !nodeTypes.every(t => typeof t === 'string')) throw new HeapSnapshotSchemaError('node_types[type] is not a string list.')
  if (!Array.isArray(edgeTypes) || !edgeTypes.every(t => typeof t === 'string')) throw new HeapSnapshotSchemaError('edge_types[type] is not a string list.')
  for (const required of ['synthetic', 'object', 'closure']) if (!nodeTypes.includes(required)) throw new HeapSnapshotSchemaError(`node type ${required} is missing.`)
  for (const required of ['element', 'hidden', 'weak', 'property', 'context', 'internal']) if (!edgeTypes.includes(required)) throw new HeapSnapshotSchemaError(`edge type ${required} is missing.`)
  const schema: HeapSnapshotSchema = {
    nodeFieldCount: nodeFields.length, edgeFieldCount: edgeFields.length,
    nodeType, nodeName: fieldIndex(nodeFields, 'name', 'node_fields'), nodeId: fieldIndex(nodeFields, 'id', 'node_fields'),
    nodeSelfSize: fieldIndex(nodeFields, 'self_size', 'node_fields'), nodeEdgeCount: fieldIndex(nodeFields, 'edge_count', 'node_fields'),
    nodeTypes: nodeTypes as string[],
    edgeType, edgeNameOrIndex: fieldIndex(edgeFields, 'name_or_index', 'edge_fields'), edgeToNode: fieldIndex(edgeFields, 'to_node', 'edge_fields'),
    edgeTypes: edgeTypes as string[],
    nodeCount: parsed.nodes.length / nodeFields.length, edgeCount: parsed.edges.length / edgeFields.length,
  }
  if (!Number.isInteger(schema.nodeCount) || !Number.isInteger(schema.edgeCount)) throw new HeapSnapshotSchemaError('nodes / edges length is not a multiple of the field count.')
  if (typeof parsed.header.node_count === 'number' && parsed.header.node_count !== schema.nodeCount) throw new HeapSnapshotSchemaError('snapshot.node_count differs from the nodes array.')
  if (typeof parsed.header.edge_count === 'number' && parsed.header.edge_count !== schema.edgeCount) throw new HeapSnapshotSchemaError('snapshot.edge_count differs from the edges array.')
  if (schema.nodeCount === 0) throw new HeapSnapshotSchemaError('The snapshot has no node.')
  return schema
}

// ---------------------------------------------------------------- graph

export interface HeapSnapshotGraph {
  schema: HeapSnapshotSchema
  parsed: ParsedHeapSnapshot
  /** Index of the first edge (in edge units, not array positions) of each node, plus the total at the end. */
  firstEdge: Uint32Array
  weakEdgeType: number
  elementEdgeType: number
  hiddenEdgeType: number
  propertyEdgeType: number
  syntheticNodeType: number
  objectNodeType: number
}

/** Validates edge counts, `to_node` targets and the synthetic root; builds the per-node edge offsets. */
export function buildHeapSnapshotGraph(parsed: ParsedHeapSnapshot): HeapSnapshotGraph {
  const schema = resolveHeapSnapshotSchema(parsed)
  const { nodes, edges } = parsed
  const firstEdge = new Uint32Array(schema.nodeCount + 1)
  let total = 0
  for (let node = 0; node < schema.nodeCount; node++) {
    firstEdge[node] = total
    total += nodes[node * schema.nodeFieldCount + schema.nodeEdgeCount]
  }
  firstEdge[schema.nodeCount] = total
  if (total !== schema.edgeCount) throw new HeapSnapshotSchemaError(`The nodes' edge_count sum ${total} differs from the edge count ${schema.edgeCount}.`)
  const edgeTypeCount = schema.edgeTypes.length
  for (let edge = 0; edge < schema.edgeCount; edge++) {
    const base = edge * schema.edgeFieldCount
    const to = edges[base + schema.edgeToNode]
    if (to % schema.nodeFieldCount !== 0 || to / schema.nodeFieldCount >= schema.nodeCount) throw new HeapSnapshotSchemaError(`Edge ${edge} points outside the nodes array.`)
    if (edges[base + schema.edgeType] >= edgeTypeCount) throw new HeapSnapshotSchemaError(`Edge ${edge} has an unknown type.`)
  }
  const nodeTypeCount = schema.nodeTypes.length
  for (let node = 0; node < schema.nodeCount; node++) {
    if (nodes[node * schema.nodeFieldCount + schema.nodeType] >= nodeTypeCount) throw new HeapSnapshotSchemaError(`Node ${node} has an unknown type.`)
    if (nodes[node * schema.nodeFieldCount + schema.nodeName] >= parsed.strings.length) throw new HeapSnapshotSchemaError(`Node ${node} names a missing string.`)
  }
  const syntheticNodeType = schema.nodeTypes.indexOf('synthetic')
  if (nodes[schema.nodeType] !== syntheticNodeType) throw new HeapSnapshotSchemaError('Node 0 is not the synthetic root.')
  return {
    schema, parsed, firstEdge,
    weakEdgeType: schema.edgeTypes.indexOf('weak'), elementEdgeType: schema.edgeTypes.indexOf('element'), hiddenEdgeType: schema.edgeTypes.indexOf('hidden'),
    propertyEdgeType: schema.edgeTypes.indexOf('property'), syntheticNodeType, objectNodeType: schema.nodeTypes.indexOf('object'),
  }
}

export function heapSnapshotNodeCount(graph: HeapSnapshotGraph): number { return graph.schema.nodeCount }

function nodeField(graph: HeapSnapshotGraph, node: number, field: number): number {
  return graph.parsed.nodes[node * graph.schema.nodeFieldCount + field]
}
export function heapSnapshotNodeType(graph: HeapSnapshotGraph, node: number): string { return graph.schema.nodeTypes[nodeField(graph, node, graph.schema.nodeType)] }
export function heapSnapshotNodeName(graph: HeapSnapshotGraph, node: number): string { return graph.parsed.strings[nodeField(graph, node, graph.schema.nodeName)] }
export function heapSnapshotNodeId(graph: HeapSnapshotGraph, node: number): number { return nodeField(graph, node, graph.schema.nodeId) }
export function heapSnapshotNodeSelfSize(graph: HeapSnapshotGraph, node: number): number { return nodeField(graph, node, graph.schema.nodeSelfSize) }

export function heapSnapshotEdgeType(graph: HeapSnapshotGraph, edge: number): string {
  return graph.schema.edgeTypes[graph.parsed.edges[edge * graph.schema.edgeFieldCount + graph.schema.edgeType]]
}
/** The edge's name; an element / hidden edge is named by its index. */
export function heapSnapshotEdgeName(graph: HeapSnapshotGraph, edge: number): string {
  const base = edge * graph.schema.edgeFieldCount
  const type = graph.parsed.edges[base + graph.schema.edgeType]
  const value = graph.parsed.edges[base + graph.schema.edgeNameOrIndex]
  if (type === graph.elementEdgeType || type === graph.hiddenEdgeType) return `[${value}]`
  const name = graph.parsed.strings[value]
  if (name === undefined) throw new HeapSnapshotSchemaError(`Edge ${edge} names a missing string.`)
  return name
}
export function heapSnapshotEdgeTarget(graph: HeapSnapshotGraph, edge: number): number {
  return graph.parsed.edges[edge * graph.schema.edgeFieldCount + graph.schema.edgeToNode] / graph.schema.nodeFieldCount
}
function isWeakEdge(graph: HeapSnapshotGraph, edge: number): boolean {
  return graph.parsed.edges[edge * graph.schema.edgeFieldCount + graph.schema.edgeType] === graph.weakEdgeType
}

// ---------------------------------------------------------------- traversal

export interface HeapSnapshotBfs {
  reached: Uint8Array
  /** Parent node of each reached node (-1 for a start node / unreached). */
  parentNode: Int32Array
  /** Edge from the parent (-1 for a start node / unreached). */
  parentEdge: Int32Array
}

/**
 * Breadth-first traversal from `starts` over non-weak edges, never crossing an edge `blocked` returns true for.
 * Deterministic: nodes and edges are visited in snapshot order.
 */
export function heapSnapshotBfs(graph: HeapSnapshotGraph, starts: readonly number[], blocked?: (edge: number) => boolean, withParents = true): HeapSnapshotBfs {
  const count = graph.schema.nodeCount
  const reached = new Uint8Array(count)
  const parentNode = withParents ? new Int32Array(count).fill(-1) : new Int32Array(0)
  const parentEdge = withParents ? new Int32Array(count).fill(-1) : new Int32Array(0)
  const queue = new Int32Array(count)
  let head = 0, tail = 0
  for (const start of starts) if (!reached[start]) { reached[start] = 1; queue[tail++] = start }
  const { firstEdge } = graph
  while (head < tail) {
    const node = queue[head++]
    for (let edge = firstEdge[node], end = firstEdge[node + 1]; edge < end; edge++) {
      if (isWeakEdge(graph, edge)) continue
      if (blocked !== undefined && blocked(edge)) continue
      const to = heapSnapshotEdgeTarget(graph, edge)
      if (reached[to]) continue
      reached[to] = 1
      if (withParents) { parentNode[to] = node; parentEdge[to] = edge }
      queue[tail++] = to
    }
  }
  return { reached, parentNode, parentEdge }
}

/** The shallow size sum of `reached` nodes, overall and restricted to nodes `isNew` accepts. */
export function heapSnapshotSizeOf(graph: HeapSnapshotGraph, reached: Uint8Array, isNew: (node: number) => boolean): { nodes: number; size: number; newNodes: number; newSize: number } {
  let nodes = 0, size = 0, newNodes = 0, newSize = 0
  for (let node = 0; node < reached.length; node++) {
    if (!reached[node]) continue
    const self = heapSnapshotNodeSelfSize(graph, node)
    nodes++; size += self
    if (isNew(node)) { newNodes++; newSize += self }
  }
  return { nodes, size, newNodes, newSize }
}

/**
 * Object shape signature used for grouping: `type:name`, and for a plain `object` node its sorted property names
 * (`Object{depth,previous,result,step}`), so objects with one constructor name are told apart by their fields.
 */
export function heapSnapshotNodeSignature(graph: HeapSnapshotGraph, node: number, maxProperties = 12): string {
  const type = heapSnapshotNodeType(graph, node)
  const name = heapSnapshotNodeName(graph, node)
  if (type !== 'object') return `${type}:${name.length > 80 ? `${name.slice(0, 77)}...` : name}`
  const properties = new Set<string>()
  const { firstEdge } = graph
  for (let edge = firstEdge[node], end = firstEdge[node + 1]; edge < end; edge++) {
    if (graph.parsed.edges[edge * graph.schema.edgeFieldCount + graph.schema.edgeType] !== graph.propertyEdgeType) continue
    const edgeName = heapSnapshotEdgeName(graph, edge)
    if (edgeName === '__proto__') continue
    properties.add(edgeName)
  }
  const sorted = [...properties].sort()
  const shown = sorted.length > maxProperties ? [...sorted.slice(0, maxProperties), `+${sorted.length - maxProperties}`] : sorted
  return `object:${name}{${shown.join(',')}}`
}

export interface HeapSnapshotPathStep {
  edgeType: string
  edgeName: string
  /** The holder of the edge. */
  from: { type: string; name: string; signature: string; isNew: boolean }
}

export function heapSnapshotRetainingPath(graph: HeapSnapshotGraph, bfs: HeapSnapshotBfs, node: number, isNew: (node: number) => boolean, maxSteps = 64): { steps: HeapSnapshotPathStep[]; target: { type: string; name: string; signature: string; isNew: boolean }; truncated: boolean } | null {
  if (!bfs.reached[node]) return null
  const steps: HeapSnapshotPathStep[] = []
  let current = node
  while (bfs.parentNode[current] >= 0 && steps.length < maxSteps) {
    const from = bfs.parentNode[current]
    const edge = bfs.parentEdge[current]
    steps.push({ edgeType: heapSnapshotEdgeType(graph, edge), edgeName: heapSnapshotEdgeName(graph, edge),
      from: { type: heapSnapshotNodeType(graph, from), name: heapSnapshotNodeName(graph, from), signature: heapSnapshotNodeSignature(graph, from), isNew: isNew(from) } })
    current = from
  }
  return { steps: steps.reverse(), target: { type: heapSnapshotNodeType(graph, node), name: heapSnapshotNodeName(graph, node), signature: heapSnapshotNodeSignature(graph, node), isNew: isNew(node) },
    truncated: bfs.parentNode[current] >= 0 }
}

// ---------------------------------------------------------------- analysis

export const PHASE2C25C_TARGETED_EDGE_NAMES = [
  'depths', 'frontier', 'results', 'previous', 'steps', 'retained', 'bonuses', 'skills', 'nextColumn', 'waiting', 'windows', 'queue', 'heap',
  'operations', 'amendmentResults', 'solution', 'operationTypeKey', 'retentionKey', 'bonusKey',
  'reservedSets', 'sets', 'resetPredictions', 'keepPredictions', 'predictions',
] as const

/** Edge types that carry a name a Search structure field / closure variable can have. */
const NAMED_EDGE_TYPES = new Set(['property', 'context', 'internal', 'shortcut'])

export interface HeapSnapshotGroup {
  key: string
  count: number
  shallowSize: number
}

export interface HeapSnapshotEdgeCut {
  /** Every node the cut makes unreachable. */
  nodes: number
  size: number
  newNodes: number
  newSize: number
}

export interface HeapSnapshotTargetedEdge {
  edgeName: string
  occurrences: number
  distinctTargets: number
  /** Occurrences by edge type (property / context / internal / shortcut). */
  byEdgeType: Record<string, number>
  /** The holders of this edge name, grouped by holder signature (top groups only). */
  holders: { holderSignature: string; occurrences: number; distinctTargets: number; edgeCut: HeapSnapshotEdgeCut | null; exampleHolderPath: ReturnType<typeof heapSnapshotRetainingPath> }[]
  /** Removing every edge with this name at once. */
  edgeCut: HeapSnapshotEdgeCut
}

export interface HeapSnapshotAnalysis {
  terminology: { dominatorTreeComputed: false; sizes: string[] }
  nodeCount: number
  edgeCount: number
  totalShallowSize: number
  reachableFromRoot: { nodes: number; size: number; newNodes: number; newSize: number }
  baselineMaxNodeId: number | null
  newNodeCount: number
  newShallowSize: number
  topByShallowSize: HeapSnapshotGroup[]
  topByCount: HeapSnapshotGroup[]
  topNewSignaturesByShallowSize: HeapSnapshotGroup[]
  topNewSignaturesByCount: HeapSnapshotGroup[]
  targetedEdges: HeapSnapshotTargetedEdge[]
  /** Collective edge cuts of edge sets (hypothesis groups). */
  groupEdgeCuts: { group: string; edgeNames: string[]; edgeTypes: string[] | null; matchedEdges: number; holderSignatures: string[]; edgeCut: HeapSnapshotEdgeCut }[]
  retainingPathExamples: { reason: string; path: ReturnType<typeof heapSnapshotRetainingPath> }[]
}

export interface HeapSnapshotEdgeGroup {
  group: string
  edgeNames: string[]
  /** Only edges whose holder has one of these signature prefixes (null: any holder). */
  holderSignaturePrefixes: string[] | null
  /** Only edges of these edge types (null: any named edge type). */
  edgeTypes: string[] | null
}

function topGroups(map: Map<string, { count: number; size: number }>, count: number, by: 'size' | 'count'): HeapSnapshotGroup[] {
  return [...map.entries()].map(([key, v]) => ({ key, count: v.count, shallowSize: v.size }))
    .sort((a, b) => (by === 'size' ? b.shallowSize - a.shallowSize || b.count - a.count : b.count - a.count || b.shallowSize - a.shallowSize) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, count)
}

/**
 * The retaining-structure summary of one snapshot. `baselineMaxNodeId` (the largest object id of the pre-Search
 * baseline snapshot of the same process) splits nodes into baseline and new; without it nothing is "new".
 */
export function analyzeHeapSnapshot(graph: HeapSnapshotGraph, options: {
  baselineMaxNodeId: number | null
  targetedEdgeNames?: readonly string[]
  edgeGroups?: readonly HeapSnapshotEdgeGroup[]
  top?: number
  holderGroupsPerEdge?: number
  edgeCutHolderGroupsPerEdge?: number
}): HeapSnapshotAnalysis {
  const top = options.top ?? 30
  const count = graph.schema.nodeCount
  const baseline = options.baselineMaxNodeId
  const isNew = (node: number) => baseline !== null && heapSnapshotNodeId(graph, node) > baseline
  const byTypeName = new Map<string, { count: number; size: number }>()
  const newBySignature = new Map<string, { count: number; size: number }>()
  const signatureCache = new Map<number, string>()
  const signatureOf = (node: number) => {
    let value = signatureCache.get(node)
    if (value === undefined) { value = heapSnapshotNodeSignature(graph, node); signatureCache.set(node, value) }
    return value
  }
  let totalShallowSize = 0, newNodeCount = 0, newShallowSize = 0
  const firstNewOfSignature = new Map<string, number>()
  for (let node = 0; node < count; node++) {
    const self = heapSnapshotNodeSelfSize(graph, node)
    totalShallowSize += self
    const typeName = `${heapSnapshotNodeType(graph, node)}:${heapSnapshotNodeName(graph, node).slice(0, 80)}`
    const current = byTypeName.get(typeName) ?? { count: 0, size: 0 }
    current.count++; current.size += self
    byTypeName.set(typeName, current)
    if (isNew(node)) {
      newNodeCount++; newShallowSize += self
      const signature = heapSnapshotNodeSignature(graph, node)
      const s = newBySignature.get(signature) ?? { count: 0, size: 0 }
      s.count++; s.size += self
      newBySignature.set(signature, s)
      if (!firstNewOfSignature.has(signature)) firstNewOfSignature.set(signature, node)
    }
  }
  const full = heapSnapshotBfs(graph, [0])
  const reachableFromRoot = heapSnapshotSizeOf(graph, full.reached, isNew)
  const cut = (blocked: (edge: number) => boolean): HeapSnapshotEdgeCut => {
    const partial = heapSnapshotBfs(graph, [0], blocked, false)
    let nodes = 0, size = 0, newNodes = 0, newSize = 0
    for (let node = 0; node < count; node++) {
      if (!full.reached[node] || partial.reached[node]) continue
      const self = heapSnapshotNodeSelfSize(graph, node)
      nodes++; size += self
      if (isNew(node)) { newNodes++; newSize += self }
    }
    return { nodes, size, newNodes, newSize }
  }

  // Named edges of interest, with their holders (the graph's edge owner is found by walking firstEdge).
  const targetedNames = options.targetedEdgeNames ?? PHASE2C25C_TARGETED_EDGE_NAMES
  const nameSet = new Set(targetedNames)
  const namedTypeIds = new Set(graph.schema.edgeTypes.map((t, i) => NAMED_EDGE_TYPES.has(t) ? i : -1).filter(i => i >= 0))
  const edgeOwner = new Int32Array(graph.schema.edgeCount)
  for (let node = 0; node < count; node++) edgeOwner.fill(node, graph.firstEdge[node], graph.firstEdge[node + 1])
  const occurrences = new Map<string, { edges: number[]; byEdgeType: Record<string, number> }>()
  for (let edge = 0; edge < graph.schema.edgeCount; edge++) {
    const type = graph.parsed.edges[edge * graph.schema.edgeFieldCount + graph.schema.edgeType]
    if (!namedTypeIds.has(type)) continue
    const name = heapSnapshotEdgeName(graph, edge)
    if (!nameSet.has(name)) continue
    const entry = occurrences.get(name) ?? { edges: [], byEdgeType: {} }
    entry.edges.push(edge)
    const typeName = graph.schema.edgeTypes[type]
    entry.byEdgeType[typeName] = (entry.byEdgeType[typeName] ?? 0) + 1
    occurrences.set(name, entry)
  }
  const edgeNameMatches = (names: Set<string>) => {
    const flags = new Uint8Array(graph.schema.edgeCount)
    for (const name of names) for (const edge of occurrences.get(name)?.edges ?? []) flags[edge] = 1
    return flags
  }
  const holderGroupsPerEdge = options.holderGroupsPerEdge ?? 5
  const edgeCutHolderGroups = options.edgeCutHolderGroupsPerEdge ?? 2
  const targetedEdges: HeapSnapshotTargetedEdge[] = targetedNames.map(edgeName => {
    const entry = occurrences.get(edgeName) ?? { edges: [], byEdgeType: {} }
    const holders = new Map<string, { edges: number[]; targets: Set<number> }>()
    const targets = new Set<number>()
    for (const edge of entry.edges) {
      const to = heapSnapshotEdgeTarget(graph, edge)
      targets.add(to)
      const signature = signatureOf(edgeOwner[edge])
      const group = holders.get(signature) ?? { edges: [], targets: new Set<number>() }
      group.edges.push(edge); group.targets.add(to)
      holders.set(signature, group)
    }
    const flags = edgeNameMatches(new Set([edgeName]))
    const holderList = [...holders.entries()].sort((a, b) => b[1].edges.length - a[1].edges.length || (a[0] < b[0] ? -1 : 1)).slice(0, holderGroupsPerEdge)
      .map(([holderSignature, group], index) => {
        let edgeCut: HeapSnapshotEdgeCut | null = null
        if (index < edgeCutHolderGroups) {
          const groupFlags = new Uint8Array(graph.schema.edgeCount)
          for (const edge of group.edges) groupFlags[edge] = 1
          edgeCut = cut(edge => groupFlags[edge] === 1)
        }
        return { holderSignature, occurrences: group.edges.length, distinctTargets: group.targets.size, edgeCut,
          exampleHolderPath: heapSnapshotRetainingPath(graph, full, edgeOwner[group.edges[0]], isNew) }
      })
    return { edgeName, occurrences: entry.edges.length, distinctTargets: targets.size, byEdgeType: entry.byEdgeType, holders: holderList,
      edgeCut: entry.edges.length === 0 ? { nodes: 0, size: 0, newNodes: 0, newSize: 0 } : cut(edge => flags[edge] === 1) }
  })

  const groupEdgeCuts = (options.edgeGroups ?? []).map(group => {
    const names = new Set(group.edgeNames)
    for (const name of names) if (!occurrences.has(name) && !nameSet.has(name)) throw new Error(`Edge group ${group.group} names ${name}, which is not a targeted edge.`)
    const flags = new Uint8Array(graph.schema.edgeCount)
    const holderSignatures = new Set<string>()
    let matchedEdges = 0
    for (const name of names) {
      for (const edge of occurrences.get(name)?.edges ?? []) {
        if (group.edgeTypes !== null && !group.edgeTypes.includes(heapSnapshotEdgeType(graph, edge))) continue
        const signature = signatureOf(edgeOwner[edge])
        if (group.holderSignaturePrefixes !== null && !group.holderSignaturePrefixes.some(prefix => signature.startsWith(prefix))) continue
        flags[edge] = 1
        matchedEdges++
        holderSignatures.add(signature)
      }
    }
    return { group: group.group, edgeNames: [...names], edgeTypes: group.edgeTypes, matchedEdges, holderSignatures: [...holderSignatures].sort().slice(0, 20),
      edgeCut: matchedEdges === 0 ? { nodes: 0, size: 0, newNodes: 0, newSize: 0 } : cut(edge => flags[edge] === 1) }
  })

  const topNewBySize = topGroups(newBySignature, top, 'size')
  const retainingPathExamples = topNewBySize.slice(0, 8).map(group => ({
    reason: `first new node (lowest node index) of the new signature ${group.key}`,
    path: heapSnapshotRetainingPath(graph, full, firstNewOfSignature.get(group.key)!, isNew),
  }))
  return {
    terminology: { dominatorTreeComputed: false, sizes: ['shallowSize', 'reachableFromRoot', 'edgeCut'] },
    nodeCount: count, edgeCount: graph.schema.edgeCount, totalShallowSize, reachableFromRoot, baselineMaxNodeId: baseline, newNodeCount, newShallowSize,
    topByShallowSize: topGroups(byTypeName, top, 'size'), topByCount: topGroups(byTypeName, top, 'count'),
    topNewSignaturesByShallowSize: topNewBySize, topNewSignaturesByCount: topGroups(newBySignature, top, 'count'),
    targetedEdges, groupEdgeCuts, retainingPathExamples,
  }
}

/** The largest object id of a snapshot (the baseline's, for the new-node split). */
export function heapSnapshotMaxNodeId(graph: HeapSnapshotGraph): number {
  let max = 0
  for (let node = 0; node < graph.schema.nodeCount; node++) max = Math.max(max, heapSnapshotNodeId(graph, node))
  return max
}
