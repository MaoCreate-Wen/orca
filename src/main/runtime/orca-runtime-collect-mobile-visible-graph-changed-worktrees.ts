// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithSyncWindowGraph } from './orca-runtime-sync-window-graph'
import type { RuntimeMobileSessionTabsResult, RuntimeSyncedTab } from '../../shared/runtime-types'
import type { RuntimeLeafRecord } from './runtime-terminal-state-records'
import type { PtyControllerInventory } from './runtime-pty-controller-contract'
import { parseExecutionHostId } from '../../shared/execution-host'
import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'

export class OrcaRuntimeWithCollectMobileVisibleGraphChangedWorktrees extends OrcaRuntimeWithSyncWindowGraph {
  // Why: toMobileSessionTabsResult resolves handles/titles from this.tabs and
  // this.leaves, so any tab/leaf delta a graph sync installs can flip the
  // client payload (pending-handle → ready, tab title) with zero change to the
  // stored snapshot. Compare exactly the projection-relevant fields and report
  // the affected worktrees; false positives only cost a coalesced no-op emit.
  protected collectMobileVisibleGraphChangedWorktrees(
    previousTabs: Map<string, RuntimeSyncedTab>,
    previousLeaves: Map<string, RuntimeLeafRecord>
  ): Set<string> {
    const changed = new Set<string>()
    for (const [tabId, tab] of this.tabs) {
      const prev = previousTabs.get(tabId)
      if (!prev || prev.title !== tab.title) {
        changed.add(tab.worktreeId)
      }
    }
    for (const [tabId, tab] of previousTabs) {
      if (!this.tabs.has(tabId)) {
        changed.add(tab.worktreeId)
      }
    }
    for (const [leafKey, leaf] of this.leaves) {
      const prev = previousLeaves.get(leafKey)
      if (
        !prev ||
        prev.ptyId !== leaf.ptyId ||
        prev.connected !== leaf.connected ||
        prev.paneTitle !== leaf.paneTitle
      ) {
        changed.add(leaf.worktreeId)
      }
    }
    for (const [leafKey, leaf] of previousLeaves) {
      if (!this.leaves.has(leafKey)) {
        changed.add(leaf.worktreeId)
      }
    }
    return changed
  }

  async listMobileSessionTabs(
    worktreeSelector: string,
    clientNavigationId?: string
  ): Promise<RuntimeMobileSessionTabsResult> {
    const explicitWorktreeId = this.getValidatedExplicitWorktreeIdSelector(worktreeSelector)
    if (explicitWorktreeId) {
      this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(explicitWorktreeId, {
        allowAttachedWindow: true,
        onlyRuntimeOwnedTerminals: true
      })
      this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(explicitWorktreeId)
      await this.refreshMobileSessionPtyRecords(explicitWorktreeId)
      this.restoreLivePairedRendererSessionOwnedMobileTerminals(explicitWorktreeId)
      this.reconcileMobileSessionBrowserTabsOnInitialList(explicitWorktreeId)
      await this.requestRendererGraphResync(explicitWorktreeId)
      return this.getMobileSessionTabsForWorktree(explicitWorktreeId, clientNavigationId)
    }
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktree.id, {
      allowAttachedWindow: true,
      onlyRuntimeOwnedTerminals: true
    })
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktree.id)
    await this.refreshMobileSessionPtyRecords()
    this.restoreLivePairedRendererSessionOwnedMobileTerminals(worktree.id)
    this.reconcileMobileSessionBrowserTabsOnInitialList(worktree.id)
    await this.requestRendererGraphResync(worktree.id)
    return this.getMobileSessionTabsForWorktree(worktree.id, clientNavigationId)
  }

  // Force-resync fires at most once per worktree per session (see gate below).
  protected forceResyncedMobileWorktrees = new Set<string>()

  // Why: the initial-list reconcile above only recovers client-hosted browser
  // pages (page registry) — it cannot see renderer-owned tabs the desktop opened
  // under an authoritative window, because the renderer only publishes a
  // worktree's snapshot when it changed. A worktree the phone enters for the
  // first time hasn't "changed" since the last sync, so its renderer-owned
  // browser tabs never reach mobileSessionTabsByWorktree and the phone shows
  // none. Ask the renderer to force a full republish of just this worktree
  // (fingerprint reset → treated as changed) and wait for its round-trip reply;
  // by the time it lands the renderer's syncWindowGraph has already committed
  // the worktree's full snapshot into the stored map, so the caller reads the
  // desktop's already-open tabs on the very first list. Headless / no-window
  // runtimes have no renderer to ask (getAvailableAuthoritativeWindow → null) so
  // this no-ops; a timeout or send failure is swallowed so the list never fails.
  protected async requestRendererGraphResync(worktreeId: string): Promise<void> {
    // Why: listMobileSessionTabs backs session.tabs.list/subscribe/unsubscribe and
    // the close/mutation RPCs, and the mobile client polls list — so resyncing
    // unconditionally would force a full renderer republish + round trip (up to the
    // 10s wait) on every one of those. The missing-pages gap only exists until the
    // renderer has published this worktree to main once, so resync at most once per
    // worktree per session, and skip entirely when main already holds the renderer's
    // accepted snapshot for it (the pages are already present).
    if (this.forceResyncedMobileWorktrees.has(worktreeId)) {
      return
    }
    if (this.acceptedRendererMobileSnapshotByWorktree.has(worktreeId)) {
      this.forceResyncedMobileWorktrees.add(worktreeId)
      return
    }
    const win = this.getAvailableAuthoritativeWindow()
    if (!win || win.isDestroyed()) {
      return
    }
    // Mark before the round trip so a concurrent list/subscribe/poll for the same
    // worktree doesn't launch a second republish while this one is in flight.
    this.forceResyncedMobileWorktrees.add(worktreeId)
    const requestId = randomUUID()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        ipcMain.removeListener('browser:requestGraphResyncReply', handler)
        resolve()
      }, 10_000)

      const handler = (
        event: Electron.IpcMainEvent,
        reply: { requestId: string }
      ): void => {
        if (event.sender !== win.webContents || reply.requestId !== requestId) {
          return
        }
        clearTimeout(timer)
        ipcMain.removeListener('browser:requestGraphResyncReply', handler)
        resolve()
      }
      ipcMain.on('browser:requestGraphResyncReply', handler)
      try {
        win.webContents.send('browser:requestGraphResync', { requestId, worktreeId })
      } catch {
        clearTimeout(timer)
        ipcMain.removeListener('browser:requestGraphResyncReply', handler)
        resolve()
      }
    })
  }

  // Why: the initial list path only hydrates terminals; browser reconcile is
  // skipped for attached-window (renderer-owned) worktrees, so the stored
  // snapshot may lack pages the desktop already has open — the phone then shows
  // none until a fresh tab is created and the renderer republishes. Pull the
  // live renderer-owned pages from the page registry (via
  // buildHeadlessMobileSessionBrowserTabs → listPages) into the stored snapshot
  // now, so the very first list carries them. No-op when the snapshot is absent
  // or already matches (reconcile bails via headlessBrowserTabsUnchanged).
  protected reconcileMobileSessionBrowserTabsOnInitialList(worktreeId: string): void {
    const existing = this.mobileSessionTabsByWorktree.get(worktreeId)
    if (!existing) {
      return
    }
    this.reconcileHeadlessMobileSessionBrowserTabs(worktreeId, existing)
  }

  async listAllMobileSessionTabs(
    clientNavigationId?: string
  ): Promise<RuntimeMobileSessionTabsResult[]> {
    return (await this.listAllMobileSessionTabsWithChangeSequence(clientNavigationId)).snapshots
  }

  async listAllMobileSessionTabsWithChangeSequence(clientNavigationId?: string): Promise<{
    snapshots: RuntimeMobileSessionTabsResult[]
    changeSequence: number
  }> {
    const inventory = await this.collectAllMobileSessionTabs(clientNavigationId)
    return { snapshots: inventory.snapshots, changeSequence: inventory.changeSequence }
  }

  protected async collectAllMobileSessionTabs(clientNavigationId?: string): Promise<{
    snapshots: RuntimeMobileSessionTabsResult[]
    ptyInventory: PtyControllerInventory | null
    changeSequence: number
  }> {
    for (const worktreeId of this.getKnownWorkspaceSessionWorktreeIds()) {
      this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId, {
        allowAttachedWindow: true,
        onlyRuntimeOwnedTerminals: true
      })
    }
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession()
    const ptyInventory = await this.refreshMobileSessionPtyInventory()
    this.restoreLivePairedRendererSessionOwnedMobileTerminals(null)
    const snapshots = [...this.mobileSessionTabsByWorktree.values()].map((snapshot) =>
      this.projectMobileSessionTabsForClient(
        this.toMobileSessionTabsResult(snapshot),
        clientNavigationId
      )
    )
    return { snapshots, ptyInventory, changeSequence: this.mobileSessionTabsChangeSequence }
  }

  async listAllMobileSessionTabsInventory(
    clientNavigationId?: string,
    signal?: AbortSignal
  ): Promise<{ snapshots: RuntimeMobileSessionTabsResult[]; authoritative?: true }> {
    const { snapshots, authoritative } =
      await this.listAllMobileSessionTabsInventoryWithChangeSequence(clientNavigationId, signal)
    return { snapshots, ...(authoritative ? { authoritative } : {}) }
  }

  async listAllMobileSessionTabsInventoryWithChangeSequence(
    clientNavigationId?: string,
    signal?: AbortSignal
  ): Promise<{
    snapshots: RuntimeMobileSessionTabsResult[]
    authoritative?: true
    changeSequence: number
  }> {
    this.assertSessionTabsInventoryRequestActive(signal)
    const primedPublicationEpoch = this.getAuthoritativeSessionTabsInventoryEpoch()
    const primed = await this.collectAllMobileSessionTabs(clientNavigationId)
    this.assertSessionTabsInventoryRequestActive(signal)
    if (
      primedPublicationEpoch !== null &&
      this.getAuthoritativeSessionTabsInventoryEpoch() === primedPublicationEpoch
    ) {
      return await this.settleSessionTabsInventory(primed, clientNavigationId, signal)
    }
    while (true) {
      const publicationEpoch = this.getAuthoritativeSessionTabsInventoryEpoch()
      if (publicationEpoch === null) {
        await this.waitForSessionTabsInventoryPublication(signal)
        continue
      }
      const inventory = await this.collectAllMobileSessionTabs(clientNavigationId)
      this.assertSessionTabsInventoryRequestActive(signal)
      if (this.getAuthoritativeSessionTabsInventoryEpoch() === publicationEpoch) {
        return await this.settleSessionTabsInventory(inventory, clientNavigationId, signal)
      }
    }
  }

  protected async settleSessionTabsInventory(
    inventory: {
      snapshots: RuntimeMobileSessionTabsResult[]
      ptyInventory: PtyControllerInventory | null
      changeSequence: number
    },
    clientNavigationId?: string,
    signal?: AbortSignal
  ): Promise<{
    snapshots: RuntimeMobileSessionTabsResult[]
    authoritative?: true
    changeSequence: number
  }> {
    if (this.isCompleteSessionTabsPtyCensus(inventory.ptyInventory)) {
      return {
        snapshots: inventory.snapshots,
        authoritative: true,
        changeSequence: inventory.changeSequence
      }
    }
    const retried = await this.collectAllMobileSessionTabs(clientNavigationId)
    this.assertSessionTabsInventoryRequestActive(signal)
    return { snapshots: retried.snapshots, changeSequence: retried.changeSequence }
  }

  supportsAuthoritativeSessionTabsInventory(): boolean {
    return process.env.ORCA_E2E_DISABLE_AUTHORITATIVE_SESSION_TABS_INVENTORY !== '1'
  }

  protected assertSessionTabsInventoryRequestActive(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('client_disconnected')
    }
  }

  protected isCompleteSessionTabsPtyCensus(inventory: PtyControllerInventory | null): boolean {
    if (!inventory) {
      return false
    }
    const knownHostIds = this.listKnownExecutionHostIds(inventory.queriedHostIds)
    return ![...knownHostIds].some((hostId) => {
      const parsed = parseExecutionHostId(hostId)
      return parsed?.kind !== 'runtime' && !inventory.queriedHostIds.has(hostId)
    })
  }
}
