import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DiagramEdge, DiagramNode, JournalDiagram, MAX_EDGES, MAX_NODES, MAX_POSITION,
  NODE_HEIGHT, NODE_WIDTH, diagramSize, edgeGeometry, makeNode, newDiagramId,
  removeDiagramNode, starterDiagram,
} from '../lib/diagram'

type Props = {
  initialData: JournalDiagram
  editable: boolean
  onChange: (data: JournalDiagram) => boolean
  onClose: () => void
  onRemove: () => void
}

// Adapted from Writing Space's FlowchartTab: a scrolling world, draggable steps
// and directed SVG connections. Journal adds a local inspector and timeline
// starter; every accepted change is sent straight to its owning journal node.
export default function DiagramEditor({ initialData, editable, onChange, onClose, onRemove }: Props) {
  const [chart, setChart] = useState(initialData)
  const chartRef = useRef(chart)
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [source, setSource] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [notice, setNotice] = useState('')
  const [, setHistoryTick] = useState(0)
  const past = useRef<JournalDiagram[]>([])
  const future = useRef<JournalDiagram[]>([])
  const lastEdit = useRef({ group: '', at: 0 })
  const drag = useRef<{ id: string; x: number; y: number; pointerX: number; pointerY: number; started: boolean } | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const windowRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const markerId = `diagram-arrow-${useId().replace(/:/g, '')}`
  const size = diagramSize(chart)
  const worldWidth = Math.max(1000, size.width)
  const worldHeight = Math.max(620, size.height)
  const activeNode = selected?.kind === 'node' ? chart.nodes.find(node => node.id === selected.id) : undefined
  const activeEdge = selected?.kind === 'edge' ? chart.edges.find(edge => edge.id === selected.id) : undefined
  const byId = new Map(chart.nodes.map(node => [node.id, node]))

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    titleRef.current?.focus()
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])

  function commit(next: JournalDiagram, group = '', remember = true) {
    if (!editable || !onChange(next)) return false
    const now = Date.now()
    if (remember && (!group || group !== lastEdit.current.group || now - lastEdit.current.at > 800)) {
      past.current = [...past.current.slice(-79), chartRef.current]
    }
    future.current = []
    lastEdit.current = { group, at: now }
    chartRef.current = next
    setChart(next)
    setHistoryTick(value => value + 1)
    setNotice('')
    return true
  }

  function travelHistory(direction: 'undo' | 'redo') {
    if (!editable) return
    const from = direction === 'undo' ? past : future
    const to = direction === 'undo' ? future : past
    const next = from.current[from.current.length - 1]
    if (!next || !onChange(next)) return
    from.current = from.current.slice(0, -1)
    to.current = [...to.current, chartRef.current]
    chartRef.current = next
    setChart(next)
    setSelected(null)
    setSource(null)
    lastEdit.current = { group: '', at: 0 }
    setHistoryTick(value => value + 1)
  }

  function updateNode(id: string, changes: Partial<DiagramNode>, group = '') {
    const current = chartRef.current
    return commit({ ...current, nodes: current.nodes.map(node => node.id === id ? { ...node, ...changes } : node) }, group)
  }
  function updateEdge(id: string, changes: Partial<DiagramEdge>) {
    const current = chartRef.current
    commit({ ...current, edges: current.edges.map(edge => edge.id === id ? { ...edge, ...changes } : edge) }, `edge-${id}-${Object.keys(changes).join()}`)
  }

  function addNode(kind: DiagramNode['kind']) {
    const current = chartRef.current
    if (current.nodes.length >= MAX_NODES) { setNotice(`This diagram already has ${MAX_NODES} steps. Add another diagram for more space.`); return }
    const scroller = viewport.current
    const baseX = Math.min(MAX_POSITION - 1000, Math.max(40, Math.round((scroller?.scrollLeft ?? 0) / zoom + 60)))
    const baseY = Math.min(MAX_POSITION - 1000, Math.max(40, Math.round((scroller?.scrollTop ?? 0) / zoom + 60)))
    const columns = Math.max(1, Math.floor((scroller?.clientWidth ?? 800) / zoom / (NODE_WIDTH + 50)))
    let x = baseX, y = baseY
    // Search nearby grid spaces instead of placing a new note over a step.
    for (let slot = 0; slot <= MAX_NODES * 6; slot++) {
      x = baseX + (slot % columns) * (NODE_WIDTH + 50)
      y = baseY + Math.floor(slot / columns) * (NODE_HEIGHT + 50)
      if (!current.nodes.some(node => Math.abs(node.x - x) < NODE_WIDTH + 24 && Math.abs(node.y - y) < NODE_HEIGHT + 24)) break
    }
    const node = makeNode(kind, Math.min(MAX_POSITION, x), Math.min(MAX_POSITION, y))
    if (commit({ ...current, nodes: [...current.nodes, node] })) {
      setSelected({ kind: 'node', id: node.id })
      setConnecting(false)
      setSource(null)
      requestAnimationFrame(() => viewport.current?.scrollTo({ left: Math.max(0, node.x * zoom - 40), top: Math.max(0, node.y * zoom - 40) }))
    }
  }

  function selectNode(id: string) {
    if (!connecting) { setSelected({ kind: 'node', id }); return }
    if (!source) { setSource(id); return }
    const current = chartRef.current
    if (current.edges.length >= MAX_EDGES) { setNotice(`This diagram has reached its ${MAX_EDGES}-connector limit.`); return }
    const edge: DiagramEdge = { id: newDiagramId(), from: source, to: id, label: '', route: 'auto' }
    if (commit({ ...current, edges: [...current.edges, edge] })) {
      setSelected({ kind: 'edge', id: edge.id })
      setSource(null)
      setConnecting(false)
    }
  }

  function startDrag(event: React.PointerEvent<HTMLButtonElement>, node: DiagramNode) {
    if (!editable || event.button !== 0 || connecting) return
    event.preventDefault()
    event.stopPropagation()
    setSelected({ kind: 'node', id: node.id })
    drag.current = { id: node.id, x: node.x, y: node.y, pointerX: event.clientX, pointerY: event.clientY, started: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || !editable) return
    const dx = (event.clientX - current.pointerX) / zoom
    const dy = (event.clientY - current.pointerY) / zoom
    if (!current.started && Math.abs(dx) + Math.abs(dy) < 3) return
    // All moves in this one drag share one Undo entry, even for a slow drag.
    if (current.started) lastEdit.current = { group: `drag-${current.id}`, at: Date.now() }
    current.started = true
    updateNode(current.id, {
      x: Math.max(40, Math.min(MAX_POSITION, Math.round(current.x + dx))),
      y: Math.max(40, Math.min(MAX_POSITION, Math.round(current.y + dy))),
    }, `drag-${current.id}`)
  }
  function finishDrag() { drag.current = null; lastEdit.current = { group: '', at: 0 } }

  function fit() {
    const view = viewport.current
    if (!view) return
    setZoom(Math.max(0.25, Math.min(1.5, (view.clientWidth - 24) / size.width, (view.clientHeight - 24) / size.height)))
    view.scrollTo({ top: 0, left: 0 })
  }
  function deleteSelection() {
    if (!selected || !editable) return
    const current = chartRef.current
    if (commit(selected.kind === 'node' ? removeDiagramNode(current, selected.id)
      : { ...current, edges: current.edges.filter(edge => edge.id !== selected.id) })) setSelected(null)
  }

  function handleKeys(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      // Do not let Escape also close the surrounding Focus editor.
      event.preventDefault(); event.stopPropagation()
      if (connecting) { setConnecting(false); setSource(null) }
      else onClose()
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.stopPropagation()
      travelHistory(event.shiftKey ? 'redo' : 'undo')
    } else if (event.key === 'Tab') {
      const controls = Array.from(windowRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    // Cmd+S deliberately continues to App's normal save handler. Every change
    // already lives in the journal node, including the most recent input event.
  }

  return createPortal(
    <div className="diagram-overlay" onMouseDown={event => event.stopPropagation()} onKeyDown={handleKeys}>
      <section className="diagram-window" role="dialog" aria-modal="true" aria-label="Edit journal diagram" ref={windowRef}>
        <header className="diagram-header">
          <div className="diagram-heading"><span className="diagram-kicker">diagram · part of this entry</span>
            <input ref={titleRef} aria-label="Diagram title" value={chart.title} maxLength={200} disabled={!editable}
              onChange={event => commit({ ...chartRef.current, title: event.target.value }, 'title')} />
          </div>
          <button className="diagram-button diagram-primary" onClick={onClose}>done</button>
        </header>
        <div className="diagram-tools">
          <button className="diagram-button" disabled={!editable} onClick={() => addNode('step')}>+ step</button>
          <button className="diagram-button" disabled={!editable} onClick={() => addNode('decision')}>+ decision</button>
          <button className="diagram-button" disabled={!editable} onClick={() => addNode('note')}>+ note</button>
          <button className={`diagram-button${connecting ? ' is-active' : ''}`} aria-pressed={connecting} disabled={!editable}
            onClick={() => { setConnecting(value => !value); setSource(null) }}>connect</button>
          <span className="diagram-tools-divider" />
          <button className="diagram-button" disabled={!editable || !past.current.length} onClick={() => travelHistory('undo')}>undo</button>
          <button className="diagram-button" disabled={!editable || !future.current.length} onClick={() => travelHistory('redo')}>redo</button>
          <div className="diagram-zoom">
            <button className="diagram-button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(0.25, value - 0.1))}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button className="diagram-button" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(2, value + 0.1))}>+</button>
            <button className="diagram-button" onClick={fit}>fit</button>
          </div>
        </div>
        <div className="diagram-hint" role="status">
          {!editable ? 'This journal is temporarily read-only.' : notice || (connecting
            ? source ? 'Choose the destination step. Choose the same step again for a loop.' : 'Choose the starting step, then its destination.'
            : 'Drag a step by its top handle. Select a step or arrow to edit its details.')}
        </div>
        <div className="diagram-body">
          <div className="diagram-canvas" ref={viewport} tabIndex={0} aria-label="Diagram canvas"
            onKeyDown={event => { if (event.target === event.currentTarget && ['Backspace', 'Delete'].includes(event.key)) { event.preventDefault(); deleteSelection() } }}>
            {!chart.nodes.length && <div className="diagram-starters">
              <h2>Give the idea some shape</h2><p>Start with a few connected steps, plan the next six months, or add your own first step.</p>
              <button className="diagram-button diagram-primary" disabled={!editable} onClick={() => commit(starterDiagram('flow'))}>start a flowchart</button>
              <button className="diagram-button" disabled={!editable} onClick={() => commit(starterDiagram('timeline'))}>six-month timeline</button>
            </div>}
            <div className="diagram-world-size" style={{ width: worldWidth * zoom, height: worldHeight * zoom }}>
              <div className="diagram-world" style={{ width: worldWidth, height: worldHeight, transform: `scale(${zoom})` }}>
                <svg className="diagram-edges" width={worldWidth} height={worldHeight}>
                  <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
                  {chart.edges.map(edge => {
                    const from = byId.get(edge.from), to = byId.get(edge.to)
                    if (!from || !to) return null
                    const geometry = edgeGeometry(from, to, edge.route)
                    return <g key={edge.id} className={activeEdge?.id === edge.id ? 'is-selected' : ''}>
                      <path className="diagram-edge-line" d={geometry.path} markerEnd={`url(#${markerId})`} />
                      <path className="diagram-edge-hit" d={geometry.path} onClick={() => setSelected({ kind: 'edge', id: edge.id })} />
                      {edge.label && <text x={geometry.labelX} y={geometry.labelY - 10} textAnchor="middle" onClick={() => setSelected({ kind: 'edge', id: edge.id })}>{edge.label}</text>}
                    </g>
                  })}
                </svg>
                {chart.nodes.map(node => <div key={node.id}
                  className={`diagram-step diagram-step-${node.kind}${activeNode?.id === node.id || source === node.id ? ' is-selected' : ''}`}
                  style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}>
                  <button className="diagram-drag" aria-label={`Move ${node.text || 'untitled step'}`} disabled={!editable || connecting}
                    onPointerDown={event => startDrag(event, node)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}
                    onKeyDown={event => {
                      const moves: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }
                      const move = moves[event.key]
                      if (!move) return
                      event.preventDefault()
                      updateNode(node.id, { x: Math.max(40, Math.min(MAX_POSITION, node.x + move[0])), y: Math.max(40, Math.min(MAX_POSITION, node.y + move[1])) })
                    }}>⋮⋮ <span>{node.kind}</span></button>
                  <button className="diagram-step-select" aria-label={`Select ${node.text || 'untitled step'}`}
                    aria-pressed={activeNode?.id === node.id || source === node.id} onClick={() => selectNode(node.id)}>
                    {node.kind === 'decision' && <svg className="diagram-diamond" viewBox="0 0 220 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="110,1 219,50 110,99 1,50" /></svg>}
                    {node.date && <span className="diagram-step-date">{node.date}</span>}
                    <strong>{node.text || 'Untitled step'}</strong>
                    {node.notes && node.kind !== 'decision' && <span className="diagram-step-notes">{node.notes}</span>}
                  </button>
                </div>)}
              </div>
            </div>
          </div>
          <aside className="diagram-inspector" aria-label="Diagram details">
            {activeNode ? <>
              <h3>{activeNode.kind === 'note' ? 'Note' : 'Step'} details</h3>
              <label>Title<input aria-label="Step title" maxLength={500} value={activeNode.text} disabled={!editable}
                onChange={event => updateNode(activeNode.id, { text: event.target.value }, `text-${activeNode.id}`)} /></label>
              <label>Date / time<input aria-label="Step date or time" maxLength={80} placeholder="e.g. January · week 3" value={activeNode.date} disabled={!editable}
                onChange={event => updateNode(activeNode.id, { date: event.target.value }, `date-${activeNode.id}`)} /></label>
              <label>Notes<textarea aria-label="Step notes" rows={6} maxLength={10000} value={activeNode.notes} disabled={!editable}
                onChange={event => updateNode(activeNode.id, { notes: event.target.value }, `notes-${activeNode.id}`)} /></label>
              <label>Shape<select aria-label="Step shape" value={activeNode.kind} disabled={!editable}
                onChange={event => updateNode(activeNode.id, { kind: event.target.value as DiagramNode['kind'] })}>
                <option value="step">Step</option><option value="decision">Decision</option><option value="note">Note</option>
              </select></label>
              <button className="diagram-button" disabled={!editable} onClick={deleteSelection}>delete step</button>
            </> : activeEdge ? <>
              <h3>Connector details</h3>
              <label>From<select aria-label="Connector from" value={activeEdge.from} disabled={!editable} onChange={event => updateEdge(activeEdge.id, { from: event.target.value })}>
                {chart.nodes.map(node => <option key={node.id} value={node.id}>{node.text || 'Untitled step'}</option>)}
              </select></label>
              <label>To<select aria-label="Connector to" value={activeEdge.to} disabled={!editable} onChange={event => updateEdge(activeEdge.id, { to: event.target.value })}>
                {chart.nodes.map(node => <option key={node.id} value={node.id}>{node.text || 'Untitled step'}</option>)}
              </select></label>
              <label>Label<input aria-label="Connector label" maxLength={300} value={activeEdge.label} disabled={!editable} onChange={event => updateEdge(activeEdge.id, { label: event.target.value })} /></label>
              <label>Route<select aria-label="Connector route" value={activeEdge.route} disabled={!editable} onChange={event => updateEdge(activeEdge.id, { route: event.target.value as DiagramEdge['route'] })}>
                <option value="auto">Automatic</option><option value="above">Above the steps</option><option value="below">Below the steps</option>
              </select></label>
              <button className="diagram-button" disabled={!editable} onClick={() => updateEdge(activeEdge.id, { from: activeEdge.to, to: activeEdge.from })}>reverse arrow</button>
              <button className="diagram-button" disabled={!editable} onClick={deleteSelection}>delete connector</button>
            </> : <><h3>Arrange your ideas</h3><p>Select a step to write its title, date, and notes. Connect any two steps, including a return to the start.</p><p>Use the scroll area to explore a large diagram, or choose Fit to see it all.</p></>}
            <div className="diagram-connection-list"><h3>Connectors · {chart.edges.length}</h3>
              {chart.edges.map((edge, index) => <button key={edge.id} className={`diagram-connection-item${activeEdge?.id === edge.id ? ' is-selected' : ''}`}
                onClick={() => setSelected({ kind: 'edge', id: edge.id })} aria-label={`Edit connector ${index + 1}: ${byId.get(edge.from)?.text} to ${byId.get(edge.to)?.text}`}>
                {byId.get(edge.from)?.text || 'Untitled'} → {byId.get(edge.to)?.text || 'Untitled'}
              </button>)}
            </div>
          </aside>
        </div>
        <footer className="diagram-footer"><span>{chart.nodes.length} steps · {chart.edges.length} connectors</span>
          <button className="diagram-button" disabled={!editable} onClick={onRemove}>remove diagram</button>
        </footer>
      </section>
    </div>, document.body,
  )
}
