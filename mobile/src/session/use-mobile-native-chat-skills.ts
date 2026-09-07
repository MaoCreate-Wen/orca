import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { getNativeChatAgentProfile } from '../../../src/shared/native-chat-agent-profiles'
import type { AgentType } from '../../../src/shared/agent-status-types'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../../src/shared/skills'

const SKILL_DISCOVERY_DEBOUNCE_MS = 120
const SKILL_DISCOVERY_TIMEOUT_MS = 10_000
const NO_SKILLS: readonly DiscoveredSkill[] = []

/** Lifecycle of skill discovery: nothing requested yet, a scan in flight
 *  (debounce + RPC), results applied, or the host scan failed — lets the picker
 *  tell "still loading" apart from "no skills" and surface a failure row. */
export type NativeChatSkillSearchStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Single object threaded to the composer so the skill picker adds one prop, not
 *  three, to the already-dense chat view and composer. */
export type MobileNativeChatSkillPicker = {
  skills: readonly DiscoveredSkill[]
  status: NativeChatSkillSearchStatus
  onNeed: () => void
}

/** Debounces one skill scan per scope over the RpcClient and re-derives the
 *  agent-visible subset without re-fetching when the active agent changes. The
 *  scan is agent-agnostic (the host returns every provider's skills plus their
 *  owning sources); visibility is applied here, mirroring the renderer's
 *  isNativeChatSkillForAgent, which Metro cannot import from src/renderer. */
export function useMobileNativeChatSkills(args: {
  client: RpcClient | null
  worktreeId: string
  agent: string | null
}): MobileNativeChatSkillPicker {
  const { client, worktreeId, agent } = args
  const [result, setResult] = useState<SkillDiscoveryResult | null>(null)
  const [nativeChatSkillStatus, setNativeChatSkillStatus] =
    useState<NativeChatSkillSearchStatus>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sequenceRef = useRef(0)
  // One scan per scope: guards against the composer re-requesting on every
  // keystroke while the picker is open, since filtering is client-side.
  const startedRef = useRef(false)

  useEffect(() => {
    sequenceRef.current++
    startedRef.current = false
    setResult(null)
    setNativeChatSkillStatus('idle')
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [client, worktreeId])

  const loadNativeChatSkills = useCallback(() => {
    if (!client || startedRef.current) {
      return
    }
    startedRef.current = true
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    const sequence = ++sequenceRef.current
    setNativeChatSkillStatus('loading')
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void (async () => {
        const response = await client.sendRequest(
          'skills.discover',
          { worktreeId },
          { timeoutMs: SKILL_DISCOVERY_TIMEOUT_MS }
        )
        if (sequenceRef.current !== sequence) {
          return
        }
        if (response.ok) {
          setResult(response.result as SkillDiscoveryResult)
          setNativeChatSkillStatus('ready')
          return
        }
        // Let the next time the picker opens retry a failed scan.
        startedRef.current = false
        setNativeChatSkillStatus('error')
      })().catch(() => {
        if (sequenceRef.current === sequence) {
          startedRef.current = false
          setNativeChatSkillStatus('error')
        }
      })
    }, SKILL_DISCOVERY_DEBOUNCE_MS)
  }, [client, worktreeId])

  const skills = useMemo(() => {
    if (!result) {
      return NO_SKILLS
    }
    const profile = getNativeChatAgentProfile(agent)
    if (!profile) {
      return NO_SKILLS
    }
    return result.skills.filter((skill) => isSkillForOwner(skill, profile.skillSourceOwner, result))
  }, [result, agent])

  return useMemo(
    () => ({ skills, status: nativeChatSkillStatus, onNeed: loadNativeChatSkills }),
    [skills, nativeChatSkillStatus, loadNativeChatSkills]
  )
}

/** A skill is visible to an agent when any root that reached it is that agent's
 *  own scope or the shared (owner === null) scope. A symlinked skill can be
 *  reachable through several roots, so all of them grant visibility. */
function isSkillForOwner(
  skill: DiscoveredSkill,
  owner: AgentType,
  result: SkillDiscoveryResult
): boolean {
  const rootPaths = skill.rootPaths?.length ? skill.rootPaths : [skill.rootPath]
  return rootPaths.some((rootPath) => {
    const source = result.sources.find((entry) => entry.path === rootPath)
    return source?.owner === null || source?.owner === owner
  })
}
