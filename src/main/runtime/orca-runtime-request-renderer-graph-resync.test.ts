import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ipcMainOnMock, ipcMainRemoveMock } = vi.hoisted(() => ({
  ipcMainOnMock: vi.fn(),
  ipcMainRemoveMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { on: ipcMainOnMock, removeListener: ipcMainRemoveMock }
}))

import { OrcaRuntimeWithCollectMobileVisibleGraphChangedWorktrees } from './orca-runtime-collect-mobile-visible-graph-changed-worktrees'

// Why: the runtime class is a deep mechanical split; exercise the gate + round
// trip on a bare prototype instance with only the fields the method touches,
// avoiding the full constructor chain.
function makeRuntime(overrides: Record<string, unknown> = {}): {
  runtime: InstanceType<typeof OrcaRuntimeWithCollectMobileVisibleGraphChangedWorktrees>
  send: ReturnType<typeof vi.fn>
} {
  const send = vi.fn()
  const win = { isDestroyed: () => false, webContents: { send } }
  const runtime = Object.create(
    OrcaRuntimeWithCollectMobileVisibleGraphChangedWorktrees.prototype
  ) as InstanceType<typeof OrcaRuntimeWithCollectMobileVisibleGraphChangedWorktrees>
  Object.assign(runtime, {
    forceResyncedMobileWorktrees: new Set<string>(),
    acceptedRendererMobileSnapshotByWorktree: new Map<string, unknown>(),
    getAvailableAuthoritativeWindow: () => win,
    ...overrides
  })
  return { runtime, send }
}

describe('requestRendererGraphResync gate + round trip', () => {
  beforeEach(() => {
    ipcMainOnMock.mockReset()
    ipcMainRemoveMock.mockReset()
    vi.useRealTimers()
  })

  it('sends one resync and resolves when the matching reply lands, marking the worktree', async () => {
    let replyHandler: ((event: unknown, reply: { requestId: string }) => void) | null = null
    ipcMainOnMock.mockImplementation((_ch: string, h: typeof replyHandler) => {
      replyHandler = h
    })
    const { runtime, send } = makeRuntime()

    const pending = (
      runtime as unknown as { requestRendererGraphResync: (w: string) => Promise<void> }
    ).requestRendererGraphResync('wt-1')

    expect(send).toHaveBeenCalledTimes(1)
    const [channel, payload] = send.mock.calls[0] as [string, { requestId: string; worktreeId: string }]
    expect(channel).toBe('browser:requestGraphResync')
    expect(payload.worktreeId).toBe('wt-1')

    // A non-matching requestId is ignored; only the correct one resolves.
    const senderWin = (
      runtime as unknown as { getAvailableAuthoritativeWindow: () => { webContents: unknown } }
    ).getAvailableAuthoritativeWindow()
    replyHandler?.({ sender: senderWin.webContents }, { requestId: 'nope' })
    replyHandler?.({ sender: senderWin.webContents }, { requestId: payload.requestId })

    await pending
    expect(ipcMainRemoveMock).toHaveBeenCalled()
    expect(
      (runtime as unknown as { forceResyncedMobileWorktrees: Set<string> }).forceResyncedMobileWorktrees.has(
        'wt-1'
      )
    ).toBe(true)
  })

  it('skips the round trip when main already holds the accepted snapshot', async () => {
    const { runtime, send } = makeRuntime({
      acceptedRendererMobileSnapshotByWorktree: new Map([['wt-1', {}]])
    })
    await (
      runtime as unknown as { requestRendererGraphResync: (w: string) => Promise<void> }
    ).requestRendererGraphResync('wt-1')
    expect(send).not.toHaveBeenCalled()
    expect(ipcMainOnMock).not.toHaveBeenCalled()
  })

  it('resyncs a worktree at most once per session', async () => {
    ipcMainOnMock.mockImplementation((_ch: string, h: (e: unknown, r: { requestId: string }) => void) => {
      // Reply synchronously on the next microtask with whatever id was sent.
      queueMicrotask(() => {
        const call = sendRef.mock.calls.at(-1) as [string, { requestId: string }] | undefined
        if (call) {
          h({ sender: winContents }, { requestId: call[1].requestId })
        }
      })
    })
    const { runtime, send } = makeRuntime()
    const sendRef = send
    const winContents = (
      runtime as unknown as { getAvailableAuthoritativeWindow: () => { webContents: unknown } }
    ).getAvailableAuthoritativeWindow().webContents

    const rrgr = (
      runtime as unknown as { requestRendererGraphResync: (w: string) => Promise<void> }
    ).requestRendererGraphResync.bind(runtime)
    await rrgr('wt-1')
    await rrgr('wt-1')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('no-ops without an authoritative window', async () => {
    const { runtime, send } = makeRuntime({ getAvailableAuthoritativeWindow: () => null })
    await (
      runtime as unknown as { requestRendererGraphResync: (w: string) => Promise<void> }
    ).requestRendererGraphResync('wt-1')
    expect(send).not.toHaveBeenCalled()
  })
})
