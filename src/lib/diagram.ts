// Diagrams live inside the journal HTML. Keep this plain-data format independent
// of React so saving, previews and validation all use the same rules.
export type DiagramNode = {
  id: string
  text: string
  notes: string
  date: string
  kind: 'step' | 'decision' | 'note'
  x: number
  y: number
}
export type DiagramEdge = {
  id: string
  from: string
  to: string
  label: string
  route: 'auto' | 'above' | 'below'
}
export type JournalDiagram = {
  version: 1
  title: string
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}
export const NODE_WIDTH = 220
export const NODE_HEIGHT = 128
export const MAX_NODES = 200
export const MAX_EDGES = 500
export const MAX_POSITION = 20000
export const newDiagramId = () => crypto.randomUUID()
export const emptyDiagram = (): JournalDiagram => ({ version: 1, title: 'Untitled diagram', nodes: [], edges: [] })

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown, max: number): value is string {
  if (typeof value !== 'string' || value.length > max) return false
  // SVG/XML and URL encoding cannot represent lone surrogate characters or
  // most control codes. Reject malformed source without losing its raw data.
  for (const character of value) {
    const code = character.codePointAt(0)!
    if ((code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff
      || (code < 32 && ![9, 10, 13].includes(code))) return false
  }
  return true
}
function coordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 40 && value <= MAX_POSITION
}

// An unreadable or newer-format diagram is kept verbatim by the editor node.
// Never silently replace it with an empty diagram or accept broken references.
export function parseDiagram(raw: string): JournalDiagram | null {
  if (raw.length > 2500000) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!record(data) || data.version !== 1 || !text(data.title, 200)
      || !Array.isArray(data.nodes) || !Array.isArray(data.edges)
      || data.nodes.length > MAX_NODES || data.edges.length > MAX_EDGES) return null
    const nodes = new Set<string>()
    const edges = new Set<string>()
    for (const node of data.nodes) {
      if (!record(node) || !text(node.id, 100) || !node.id || nodes.has(node.id)
        || !text(node.text, 500) || !text(node.notes, 10000) || !text(node.date, 80)
        || !['step', 'decision', 'note'].includes(String(node.kind))
        || !coordinate(node.x) || !coordinate(node.y)) return null
      nodes.add(node.id)
    }
    for (const edge of data.edges) {
      if (!record(edge) || !text(edge.id, 100) || !edge.id || edges.has(edge.id)
        || !text(edge.from, 100) || !nodes.has(edge.from)
        || !text(edge.to, 100) || !nodes.has(edge.to)
        || !text(edge.label, 300) || !['auto', 'above', 'below'].includes(String(edge.route))) return null
      edges.add(edge.id)
    }
    return data as JournalDiagram
  } catch { return null }
}

export function makeNode(kind: DiagramNode['kind'], x: number, y: number): DiagramNode {
  return { id: newDiagramId(), text: kind === 'note' ? 'New note' : kind === 'decision' ? 'Decision?' : 'New step',
    notes: '', date: '', kind, x, y }
}

export function starterDiagram(kind: 'flow' | 'timeline', today = new Date()): JournalDiagram {
  const count = kind === 'timeline' ? 6 : 3
  const nodes = Array.from({ length: count }, (_, index) => {
    // A folded timeline keeps six months legible inside an ordinary window.
    // Its second row reads right to left, following the arrows from month three.
    const column = index < 3 ? index : 5 - index
    const node = makeNode('step', 80 + column * 300, index < 3 ? 90 : 350)
    if (kind === 'timeline') {
      node.date = new Date(today.getFullYear(), today.getMonth() + index, 1)
        .toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
      node.text = `Month ${index + 1}`
    } else node.text = ['Start', 'Next step', 'Outcome'][index]
    return node
  })
  return { version: 1, title: kind === 'timeline' ? 'The next six months' : 'Flowchart', nodes,
    edges: nodes.slice(1).map((node, index) => ({ id: newDiagramId(), from: nodes[index].id, to: node.id, label: '', route: 'auto' })) }
}

export function removeDiagramNode(data: JournalDiagram, id: string): JournalDiagram {
  return { ...data, nodes: data.nodes.filter(node => node.id !== id),
    edges: data.edges.filter(edge => edge.from !== id && edge.to !== id) }
}

export function diagramSize(data: JournalDiagram) {
  return {
    width: Math.max(400, ...data.nodes.map(node => node.x + NODE_WIDTH + 90)),
    height: Math.max(220, ...data.nodes.map(node => node.y + NODE_HEIGHT + 130)),
  }
}

// Curves use the same free-placement approach as Writing Space's FlowchartTab.
// Vertical links, deliberate above/below routes, and loops extend that basis.
export function edgeGeometry(from: DiagramNode, to: DiagramNode, route: DiagramEdge['route']) {
  const cx = (node: DiagramNode) => node.x + NODE_WIDTH / 2
  const cy = (node: DiagramNode) => node.y + NODE_HEIGHT / 2
  if (from.id === to.id) {
    if (route !== 'auto') {
      const y = route === 'above' ? from.y : from.y + NODE_HEIGHT
      const bend = route === 'above' ? Math.max(12, y - 100) : y + 100
      return { path: `M ${cx(from) - 35} ${y} C ${cx(from) - 80} ${bend}, ${cx(from) + 80} ${bend}, ${cx(from) + 35} ${y}`,
        labelX: cx(from), labelY: y * 0.25 + bend * 0.75 }
    }
    const x = from.x + NODE_WIDTH
    const y = cy(from)
    return { path: `M ${x} ${y - 24} C ${x + 110} ${y - 100}, ${x + 110} ${y + 100}, ${x} ${y + 24}`,
      labelX: x + 72, labelY: y }
  }
  if (route !== 'auto') {
    const above = route === 'above'
    const y1 = above ? from.y : from.y + NODE_HEIGHT
    const y2 = above ? to.y : to.y + NODE_HEIGHT
    const bend = above ? Math.max(20, Math.min(y1, y2) - 60) : Math.max(y1, y2) + 80
    return { path: `M ${cx(from)} ${y1} C ${cx(from)} ${bend}, ${cx(to)} ${bend}, ${cx(to)} ${y2}`,
      labelX: (cx(from) + cx(to)) / 2, labelY: (y1 + y2) / 8 + bend * 0.75 }
  }
  if (Math.abs(cx(to) - cx(from)) < NODE_WIDTH && Math.abs(cy(to) - cy(from)) > NODE_HEIGHT) {
    const direction = to.y >= from.y ? 1 : -1
    const y1 = from.y + (direction === 1 ? NODE_HEIGHT : 0)
    const y2 = to.y + (direction === 1 ? 0 : NODE_HEIGHT)
    const mid = (y1 + y2) / 2
    return { path: `M ${cx(from)} ${y1} C ${cx(from)} ${mid}, ${cx(to)} ${mid}, ${cx(to)} ${y2}`,
      labelX: (cx(from) + cx(to)) / 2, labelY: mid }
  }
  const direction = to.x >= from.x ? 1 : -1
  const x1 = from.x + (direction === 1 ? NODE_WIDTH : 0)
  const x2 = to.x + (direction === 1 ? 0 : NODE_WIDTH)
  const bend = Math.max(60, Math.abs(x2 - x1) * 0.45)
  return { path: `M ${x1} ${cy(from)} C ${x1 + bend * direction} ${cy(from)}, ${x2 - bend * direction} ${cy(to)}, ${x2} ${cy(to)}`,
    labelX: (x1 + x2) / 2, labelY: (cy(from) + cy(to)) / 2 }
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!))
function lines(value: string, width: number, limit: number): string[] {
  const result: string[] = []
  for (const word of value.trim().split(/\s+/)) {
    if (!result.length || result[result.length - 1].length + word.length + 1 > width) result.push(word)
    else result[result.length - 1] += ` ${word}`
  }
  return result.slice(0, limit).map((line, index) => line.slice(0, width) + ((line.length > width || (index === limit - 1 && result.length > limit)) ? '…' : ''))
}

// A self-contained SVG preview makes diagrams visible outside Journal too.
// User text is escaped and never becomes HTML, SVG instructions, or a URL.
export function diagramSvg(data: JournalDiagram): string {
  const { width, height } = diagramSize(data)
  const byId = new Map(data.nodes.map(node => [node.id, node]))
  const arrows = data.edges.map(edge => {
    const from = byId.get(edge.from), to = byId.get(edge.to)
    if (!from || !to) return ''
    const geometry = edgeGeometry(from, to, edge.route)
    return `<path d="${geometry.path}" fill="none" stroke="#397880" stroke-width="2" marker-end="url(#arrow)"/>`
      + (edge.label ? `<text x="${geometry.labelX}" y="${geometry.labelY - 8}" text-anchor="middle" font-size="12" fill="#243b3d" stroke="#f4f0e5" stroke-width="4" paint-order="stroke">${escapeXml(edge.label)}</text>` : '')
  }).join('')
  const boxes = data.nodes.map(node => {
    const shape = node.kind === 'decision'
      ? `<polygon points="${node.x + NODE_WIDTH / 2},${node.y} ${node.x + NODE_WIDTH},${node.y + NODE_HEIGHT / 2} ${node.x + NODE_WIDTH / 2},${node.y + NODE_HEIGHT} ${node.x},${node.y + NODE_HEIGHT / 2}"/>`
      : `<rect x="${node.x}" y="${node.y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="${node.kind === 'note' ? 8 : 0}"/>`
    const textLines = lines(node.text || 'Untitled step', node.kind === 'decision' ? 17 : 25, 2)
    const notes = lines(node.notes, 28, 2)
    return `<g fill="${node.kind === 'note' ? '#f3e7c9' : '#fcfaf3'}" stroke="#397880" stroke-width="1.5">${shape}</g>`
      + `<g text-anchor="middle" fill="#243b3d"><text x="${node.x + NODE_WIDTH / 2}" y="${node.y + 23}" font-size="11">${escapeXml(node.date)}</text>`
      + textLines.map((line, index) => `<text x="${node.x + NODE_WIDTH / 2}" y="${node.y + 50 + index * 18}" font-size="14">${escapeXml(line)}</text>`).join('')
      + (node.kind !== 'decision' ? notes.map((line, index) => `<text x="${node.x + NODE_WIDTH / 2}" y="${node.y + 92 + index * 14}" font-size="10">${escapeXml(line)}</text>`).join('') : '') + '</g>'
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escapeXml(data.title)}</title><rect width="100%" height="100%" fill="#f4f0e5"/><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#397880"/></marker></defs><g font-family="monospace">${arrows}${boxes}${data.nodes.length ? '' : '<text x="200" y="110" text-anchor="middle" fill="#397880">Open diagram to add steps</text>'}</g></svg>`
}
export const diagramImage = (data: JournalDiagram) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagramSvg(data))}`
