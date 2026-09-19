import { KOFI_URL } from '@quiztape/shared';
import { Linking, Platform, Pressable, StyleSheet, Text } from 'react-native';

import { fonts, palette, radius, spacing } from '@/theme/tokens';

/**
 * "Buy me a tape" link to Ko-fi. Web only for now: Apple requires in-app
 * purchase for developer tips and Google's policy is unclear, so the native
 * builds hide it until that is settled. Renders nothing without a Ko-fi name.
 */
export function SupportLink({ compact = false }: { compact?: boolean }) {
  const url = KOFI_URL;
  if (!url || Platform.OS !== 'web') return null;
  return (
    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)} style={({ pressed }) => [compact ? styles.compact : styles.button, pressed && styles.pressed]}>
      <Text style={compact ? styles.compactLabel : styles.label}>☕ Buy me a tape</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.cyan },
  label: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 13, letterSpacing: 1 },
  compact: { padding: spacing.sm },
  compactLabel: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 11, textDecorationLine: 'underline' },
  pressed: { opacity: 0.8 },
});
