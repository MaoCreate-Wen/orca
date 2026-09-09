// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  republishMobileSessionWorktree: vi.fn(),
  replyGraphResync: vi.fn(),
  resyncListener: null as ((data: { requestId: string; worktreeId: string }) => void) | null
}))

vi.mock('@/runtime/sync-runtime-graph/graph-publication', () => ({
  republishMobileSessionWorktree: mocks.republishMobileSessionWorktree
}))
vi.mock('@/components/browser-pane/host-guest/webview-registry', () => ({
  destroyPersistentWebview: vi.fn()
}))
vi.mock('../../store', () => ({ useAppStore: { getState: vi.fn() } }))
vi.mock('./browser-automation-bootstrap-lease', () => ({
  acquireBrowserAutomationBootstrapLease: vi.fn()
}))
vi.mock('../../store/pinned-tab-close-guard', () => ({
  guardPinnedTabClose: vi.fn(),
  isUnifiedTabPinned: vi.fn(),
  resolvePinnedTabLabel: vi.fn()
}))

import { registerBrowserRequestIpcBridge } from './browser-request-ipc-bridge'

describe('browser graph-resync bridge', () => {
  beforeEach(() => {
    mocks.republishMobileSessionWorktree.mockReset().mockResolvedValue(undefined)
    mocks.replyGraphResync.mockReset()
    mocks.resyncListener = null
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ui: {
          onRequestTabCreate: () => () => {},
          replyTabCreate: vi.fn(),
          onRequestGraphResync: (listener: typeof mocks.resyncListener) => {
            mocks.resyncListener = listener
            return () => {}
          },
          replyGraphResync: mocks.replyGraphResync,
          onRequestTabSetProfile: () => () => {},
          replyTabSetProfile: vi.fn(),
          onRequestTabClose: () => () => {},
          replyTabClose: vi.fn()
        }
      }
    })
  })

  it('republishes the worktree then replies once the graph is pushed', async () => {
    registerBrowserRequestIpcBridge([], () => false)

    mocks.resyncListener?.({ requestId: 'resync-1', worktreeId: 'wt-1' })

    await vi.waitFor(() =>
      expect(mocks.replyGraphResync).toHaveBeenCalledExactlyOnceWith({ requestId: 'resync-1' })
    )
    expect(mocks.republishMobileSessionWorktree).toHaveBeenCalledExactlyOnceWith('wt-1')
  })

  it('still replies when the republish fails so the awaiting list never hangs', async () => {
    mocks.republishMobileSessionWorktree.mockRejectedValue(new Error('sync failed'))
    registerBrowserRequestIpcBridge([], () => false)

    mocks.resyncListener?.({ requestId: 'resync-2', worktreeId: 'wt-2' })

    await vi.waitFor(() =>
      expect(mocks.replyGraphResync).toHaveBeenCalledExactlyOnceWith({ requestId: 'resync-2' })
    )
  })
})
