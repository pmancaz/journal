import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const external = vi.hoisted(() => ({ openUrl: vi.fn(), postMessage: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: external.openUrl }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
})
afterEach(() => vi.unstubAllGlobals())

describe('user-activated external web links', () => {
  it('uses the WKWebView journal bridge without trying to call an absent Tauri runtime', async () => {
    vi.stubGlobal('window', { webkit: { messageHandlers: { journal: { postMessage: external.postMessage } } } })
    const { openExternalUrl } = await import('./documentBackend')
    await openExternalUrl('https://www.youtube.com/watch?v=abcdefghijk')
    expect(external.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'openExternal', url: 'https://www.youtube.com/watch?v=abcdefghijk' })
    expect(external.openUrl).not.toHaveBeenCalled()
  })
  it('preserves the Tauri opener path without a WKWebView handler', async () => {
    vi.stubGlobal('window', {})
    const { openExternalUrl } = await import('./documentBackend')
    await openExternalUrl('https://example.com/a%20page')
    expect(external.openUrl).toHaveBeenCalledExactlyOnceWith('https://example.com/a%20page')
    expect(external.postMessage).not.toHaveBeenCalled()
  })
  it.each(['javascript:alert(1)', 'file:///private/example', 'data:text/html,example', 'not a URL'])('does not send unsafe or malformed URL %s across either native boundary', async url => {
    vi.stubGlobal('window', { webkit: { messageHandlers: { journal: { postMessage: external.postMessage } } } })
    const { openExternalUrl } = await import('./documentBackend')
    await expect(openExternalUrl(url)).rejects.toThrow()
    expect(external.openUrl).not.toHaveBeenCalled()
    expect(external.postMessage).not.toHaveBeenCalled()
  })
})
