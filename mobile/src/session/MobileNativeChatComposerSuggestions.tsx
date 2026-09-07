import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import type { SlashCommandSuggestion } from '../../../src/shared/native-chat-slash-commands'
import type { DiscoveredSkill } from '../../../src/shared/skills'

/** One row of the composer autocomplete: an agent slash command (with its
 *  catalog description, desktop parity), a discovered skill (grouped-slash agents
 *  list these under `/` too), or a worktree file path. */
export type ComposerSuggestion =
  | { kind: 'command'; command: SlashCommandSuggestion }
  | { kind: 'skill'; skill: DiscoveredSkill }
  | { kind: 'file'; path: string }

export function composerSuggestionKey(suggestion: ComposerSuggestion): string {
  switch (suggestion.kind) {
    case 'command':
      return `command:${suggestion.command.name}`
    case 'skill':
      return `skill:${suggestion.skill.id}`
    default:
      return `file:${suggestion.path}`
  }
}

/** The text the suggestion inserts at the trigger span. A skill dispatches like a
 *  slash command on grouped-slash agents (Claude invokes skills as `/name`). */
export function composerSuggestionInsertText(suggestion: ComposerSuggestion): string {
  switch (suggestion.kind) {
    case 'command':
      return `/${suggestion.command.name}`
    case 'skill':
      return `/${suggestion.skill.name}`
    default:
      return `@${suggestion.path}`
  }
}

function composerSuggestionDescription(suggestion: ComposerSuggestion): string | null {
  if (suggestion.kind === 'command') {
    return suggestion.command.description ?? null
  }
  if (suggestion.kind === 'skill') {
    return suggestion.skill.description ?? null
  }
  return null
}

export function MobileNativeChatComposerSuggestions({
  suggestions,
  onPick
}: {
  suggestions: readonly ComposerSuggestion[]
  onPick: (suggestion: ComposerSuggestion) => void
}): React.JSX.Element {
  return (
    <View style={styles.suggestions}>
      <ScrollView keyboardShouldPersistTaps="always" style={styles.suggestionScroll}>
        {suggestions.map((suggestion) => (
          <Pressable
            key={composerSuggestionKey(suggestion)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
            onPress={() => onPick(suggestion)}
          >
            <View style={styles.suggestionRow}>
              <Text style={styles.suggestionText} numberOfLines={1}>
                {composerSuggestionInsertText(suggestion)}
              </Text>
              {suggestion.kind === 'skill' ? (
                <Text style={styles.suggestionBadge}>Skill</Text>
              ) : null}
            </View>
            {composerSuggestionDescription(suggestion) ? (
              <Text style={styles.suggestionDescription} numberOfLines={1}>
                {composerSuggestionDescription(suggestion)}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  suggestions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  suggestionScroll: {
    maxHeight: 220
  },
  suggestion: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    gap: 1
  },
  suggestionPressed: {
    backgroundColor: colors.bgRaised
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  suggestionText: {
    color: colors.textPrimary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize
  },
  suggestionBadge: {
    color: colors.textMuted,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4
  },
  suggestionDescription: {
    color: colors.textSecondary,
    fontSize: typography.metaSize
  }
})
