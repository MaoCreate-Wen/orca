import { describe, expect, it } from 'vitest'
import { classifyMobileNativeChatSend } from './mobile-native-chat-send-classification'

describe('classifyMobileNativeChatSend', () => {
  it('classifies catalog commands per agent', () => {
    expect(classifyMobileNativeChatSend('claude', '/clear')).toBe('command')
    expect(classifyMobileNativeChatSend('claude', '/compact')).toBe('command')
    expect(classifyMobileNativeChatSend('codex', '/model')).toBe('command')
    expect(classifyMobileNativeChatSend('codex', '/permissions')).toBe('command')
  })

  it('treats slash tokens outside the agent catalog as unknown, never chat', () => {
    // `/model` is surfaced by the composer's own session-option picker, not the
    // Claude slash catalog, and `/diff` is Codex-only — both still dispatch to
    // the TUI, so they must not get a chat bubble, but can't claim a command ran.
    expect(classifyMobileNativeChatSend('claude', '/model sonnet')).toBe('unknown-token')
    expect(classifyMobileNativeChatSend('claude', '/notacommand')).toBe('unknown-token')
    expect(classifyMobileNativeChatSend('claude', '/diff')).toBe('unknown-token')
  })

  it('keeps prose as chat, including leading-whitespace slash text', () => {
    expect(classifyMobileNativeChatSend('claude', 'hello there')).toBe('chat')
    expect(classifyMobileNativeChatSend('claude', ' /clear is a command')).toBe('chat')
    expect(classifyMobileNativeChatSend('claude', '/usr/bin/python is missing')).toBe(
      'unknown-token'
    )
  })

  it('treats $ tokens as skill grammar only for Codex', () => {
    expect(classifyMobileNativeChatSend('codex', '$deploy now')).toBe('unknown-token')
    expect(classifyMobileNativeChatSend('claude', '$PATH is empty')).toBe('chat')
  })

  it('defaults to chat when no agent is resolved', () => {
    expect(classifyMobileNativeChatSend(null, '/clear')).toBe('chat')
  })
})
