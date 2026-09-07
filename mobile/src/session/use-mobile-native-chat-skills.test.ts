import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../../src/shared/skills'
import { useMobileNativeChatSkills } from './use-mobile-native-chat-skills'

type PickerState = ReturnType<typeof useMobileNativeChatSkills>

function skill(id: string, name: string, rootPath: string): DiscoveredSkill {
  return {
    id,
    name,
    description: `${name} skill`,
    providers: ['claude'],
    sourceKind: 'home',
    sourceLabel: 'home',
    rootPath,
    directoryPath: `${rootPath}/${name}`,
    skillFilePath: `${rootPath}/${name}/SKILL.md`,
    installed: true,
    updatedAt: null
  }
}

function rpcSuccess(result: SkillDiscoveryResult): Awaited<ReturnType<RpcClient['sendRequest']>> {
  return { id: 'skills', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

// A claude-owned root and a shared (owner: null) root are visible; a codex-owned
// root is not, for a claude agent.
const DISCOVERY: SkillDiscoveryResult = {
  skills: [
    skill('s1', 'reviewer', '/home/.claude/skills'),
    skill('s2', 'shared-thing', '/shared/skills'),
    skill('s3', 'codex-only', '/home/.codex/skills')
  ],
  sources: [
    { id: 'a', label: 'claude', path: '/home/.claude/skills', sourceKind: 'home', providers: ['claude'], owner: 'claude', exists: true },
    { id: 'b', label: 'shared', path: '/shared/skills', sourceKind: 'home', providers: ['agent-skills'], owner: null, exists: true },
    { id: 'c', label: 'codex', path: '/home/.codex/skills', sourceKind: 'home', providers: ['codex'], owner: 'codex', exists: true }
  ],
  scannedAt: 0
}

describe('useMobileNativeChatSkills', () => {
  let renderer: ReactTestRenderer | null = null
  let state: PickerState | null = null

  async function mount(client: RpcClient, agent: string | null = 'claude'): Promise<void> {
    function Harness(): null {
      state = useMobileNativeChatSkills({ client, worktreeId: 'wt-1', agent })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    state = null
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('discovers once (debounced) and lists only the agent-visible skills', async () => {
    const sendRequest = vi.fn().mockResolvedValue(rpcSuccess(DISCOVERY))
    await mount({ sendRequest } as unknown as RpcClient)

    expect(state?.status).toBe('idle')
    act(() => {
      state?.onNeed()
      state?.onNeed()
    })
    expect(state?.status).toBe('loading')
    await act(async () => vi.advanceTimersByTimeAsync(119))
    expect(sendRequest).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendRequest).toHaveBeenCalledWith('skills.discover', { worktreeId: 'wt-1' }, {
      timeoutMs: 10_000
    })
    expect(state?.status).toBe('ready')
    // codex-only root is filtered out for a claude agent.
    expect(state?.skills.map((s) => s.name)).toEqual(['reviewer', 'shared-thing'])
  })

  it('does not re-scan while the picker stays open', async () => {
    const sendRequest = vi.fn().mockResolvedValue(rpcSuccess(DISCOVERY))
    await mount({ sendRequest } as unknown as RpcClient)

    act(() => state?.onNeed())
    await act(async () => vi.advanceTimersByTimeAsync(120))
    act(() => state?.onNeed())
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('surfaces an error and lets the next open retry', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ id: 'x', ok: false, error: { code: 'boom', message: 'no' } })
      .mockResolvedValueOnce(rpcSuccess(DISCOVERY))
    await mount({ sendRequest } as unknown as RpcClient)

    act(() => state?.onNeed())
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(state?.status).toBe('error')

    act(() => state?.onNeed())
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(state?.status).toBe('ready')
  })

  it('lists no skills for an agent with no native-chat profile', async () => {
    const sendRequest = vi.fn().mockResolvedValue(rpcSuccess(DISCOVERY))
    await mount({ sendRequest } as unknown as RpcClient, 'some-unknown-agent')

    act(() => state?.onNeed())
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(state?.skills).toEqual([])
  })
})
