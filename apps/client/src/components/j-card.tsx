import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, palette, radius, spacing } from '@/theme/tokens';

interface JCardProps {
  side: 'a' | 'b';
  index: number;
  total: number;
  prompt: string;
  hint?: string | null;
  children?: ReactNode;
}

/**
 * The question card, styled as a cassette J-card: cream stock, a coloured
 * spine stripe for the side, ruled lines and marker handwriting.
 */
export function JCard({ side, index, total, prompt, hint, children }: JCardProps) {
  const accent = side === 'a' ? palette.magenta : palette.cyan;
  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={[styles.spine, { backgroundColor: accent }]}>
        <Text style={styles.spineLabel}>SIDE {side.toUpperCase()}</Text>
        <Text style={styles.spineLabel}>
          {index + 1} / {total}
        </Text>
      </View>
      <View style={styles.body}>
        <View style={styles.rule} />
        <Text style={styles.prompt} accessibilityRole="header">
          {prompt}
        </Text>
        <View style={styles.rule} />
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {children ? <View style={styles.slot}>{children}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: palette.cream,
    width: '100%',
    minHeight: 220,
  },
  spine: { width: 40, alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  spineLabel: {
    color: palette.base,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1,
    transform: [{ rotate: '-90deg' }],
    width: 90,
    textAlign: 'center',
  },
  body: { flex: 1, padding: spacing.lg, gap: spacing.sm, justifyContent: 'center' },
  rule: { height: 1, backgroundColor: 'rgba(11, 11, 16, 0.12)' },
  prompt: { color: palette.base, fontFamily: fonts.marker, fontSize: 26, lineHeight: 36 },
  hint: { color: palette.chromeDim, fontFamily: fonts.mono, fontSize: 12 },
  slot: { marginTop: spacing.sm },
});
