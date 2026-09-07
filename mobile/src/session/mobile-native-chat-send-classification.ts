// Mobile counterpart of desktop's send classification gate
// (src/renderer/src/components/native-chat/NativeChatComposer.tsx): slash/skill
// sends are TUI control actions, not chat turns — they never echo as a user
// bubble, because the transcript will never contain a matching user turn and
// the optimistic echo would never reconcile.

import {
  getNativeChatAgentProfile,
  getVerifiedNativeChatCommands
} from '../../../src/shared/native-chat-agent-profiles'
import {
  classifyNativeChatSend,
  type NativeChatSendClassification
} from '../../../src/shared/native-chat-slash-commands'

export type { NativeChatSendClassification }

/** Classify a mobile chat send for the tab's agent. The mobile skill picker only
 *  serves grouped-slash (`/`) agents, whose skills invoke as ordinary `/name`
 *  slash tokens — they dispatch into the TUI like any command (no optimistic
 *  bubble), so there is no picker-origin token that reclassifies a `/token` as
 *  chat (that reclassification is only for the `$`-prefix skill grammar). */
export function classifyMobileNativeChatSend(
  agent: string | null,
  text: string
): NativeChatSendClassification {
  if (!agent) {
    return 'chat'
  }
  const profile = getNativeChatAgentProfile(agent)
  return classifyNativeChatSend(
    text,
    getVerifiedNativeChatCommands(agent),
    null,
    profile?.skillPrefix ?? null
  )
}
