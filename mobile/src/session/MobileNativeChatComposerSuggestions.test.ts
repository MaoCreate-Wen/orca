import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import {
  composerSuggestionInsertText,
  composerSuggestionKey,
  MobileNativeChatComposerSuggestions,
  type ComposerSuggestion
} from './MobileNativeChatComposerSuggestions'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

function mkSkill(id: string, name: string, description: string | null): DiscoveredSkill {
  return { id, name, description } as unknown as DiscoveredSkill
}

const SKILL_SUGGESTION: ComposerSuggestion = {
  kind: 'skill',
  skill: mkSkill('s1', 'reviewer', 'Review the diff')
}

describe('composer suggestion helpers', () => {
  it('inserts a skill as a slash invocation', () => {
    expect(composerSuggestionInsertText(SKILL_SUGGESTION)).toBe('/reviewer')
    expect(composerSuggestionInsertText({ kind: 'command', command: { name: 'clear' } })).toBe(
      '/clear'
    )
    expect(composerSuggestionInsertText({ kind: 'file', path: 'src/app.ts' })).toBe('@src/app.ts')
  })

  it('keys a skill by its id so two skills with the same name stay distinct', () => {
    expect(composerSuggestionKey(SKILL_SUGGESTION)).toBe('skill:s1')
  })
})

describe('MobileNativeChatComposerSuggestions', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function textOf(node: ReactTestInstance): string {
    return node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('')
  }

  it('renders a skill row with its slash text, a Skill badge, and its description', () => {
    act(() => {
      renderer = create(
        createElement(MobileNativeChatComposerSuggestions, {
          suggestions: [SKILL_SUGGESTION],
          onPick: vi.fn()
        })
      )
    })
    const texts = renderer!.root.findAll((n) => n.type === ('Text' as never)).map(textOf)
    expect(texts).toContain('/reviewer')
    expect(texts).toContain('Skill')
    expect(texts).toContain('Review the diff')
  })

  it('invokes onPick with the tapped suggestion', () => {
    const onPick = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileNativeChatComposerSuggestions, {
          suggestions: [SKILL_SUGGESTION],
          onPick
        })
      )
    })
    const row = renderer!.root.find(
      (n) => n.type === ('Pressable' as never) && typeof n.props.onPress === 'function'
    )
    row.props.onPress()
    expect(onPick).toHaveBeenCalledWith(SKILL_SUGGESTION)
  })
})
