// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DiagramEditor from './DiagramEditor'
import { JournalDiagram, starterDiagram } from '../lib/diagram'

let root: Root
let container: HTMLDivElement
let latest: JournalDiagram
const changed = vi.fn((data: JournalDiagram) => { latest = data; return true })
function button(name: string) {
  const found = Array.from(document.querySelectorAll('button')).find(element => element.getAttribute('aria-label') === name || element.textContent?.trim() === name)
  expect(found, name).toBeDefined()
  return found!
}
async function click(name: string) { await act(async () => button(name).dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
function pointer(target: HTMLElement, type: string, x: number, y: number) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }))
}
beforeEach(async () => {
  changed.mockClear()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  HTMLElement.prototype.setPointerCapture = () => undefined
  HTMLElement.prototype.scrollTo = () => undefined
  latest = starterDiagram('flow')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<DiagramEditor initialData={latest} editable onChange={changed} onClose={() => undefined} onRemove={() => undefined} />))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('diagram editing gestures and history', () => {
  it('maps dragging through zoom and undoes an entire drag in one step', async () => {
    await click('Zoom out')
    const handle = button('Move Start')
    await act(async () => {
      pointer(handle, 'pointerdown', 100, 100)
      pointer(handle, 'pointermove', 145, 145)
    })
    await act(async () => {
      pointer(handle, 'pointermove', 190, 190)
      pointer(handle, 'pointerup', 190, 190)
    })
    expect(latest.nodes[0].x).toBe(180)
    expect(latest.nodes[0].y).toBe(190)
    await click('undo')
    expect(latest.nodes[0].x).toBe(80)
    expect(latest.nodes[0].y).toBe(90)
    await click('redo')
    expect(latest.nodes[0].x).toBe(180)
  })

  it('creates feedback and self-loop connectors and undoes step deletion with its edges', async () => {
    await click('connect'); await click('Select Outcome'); await click('Select Start')
    expect(latest.edges).toHaveLength(3)
    expect(latest.edges[2].from).toBe(latest.nodes[2].id)
    expect(latest.edges[2].to).toBe(latest.nodes[0].id)
    await click('connect'); await click('Select Start'); await click('Select Start')
    expect(latest.edges).toHaveLength(4)
    expect(latest.edges[3].from).toBe(latest.edges[3].to)
    await click('Select Start'); await click('delete step')
    expect(latest.nodes).toHaveLength(2)
    expect(latest.edges).toHaveLength(1)
    await click('undo')
    expect(latest.nodes).toHaveLength(3)
    expect(latest.edges).toHaveLength(4)
  })
})
