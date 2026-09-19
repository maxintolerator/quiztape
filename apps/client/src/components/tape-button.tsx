import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { palette, radius, spacing } from '@/theme/tokens';

interface TapeButtonProps {
  label: string;
  onPress: () => void;
  tone?: 'a' | 'b' | 'neutral';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
  icon?: ReactNode;
}

/** Primary action button. Magenta = Side A energy, cyan = Side B. Visible focus ring for keyboards. */
export function TapeButton({ label, onPress, tone = 'a', disabled = false, busy = false, style, icon }: TapeButtonProps) {
  const background = tone === 'a' ? palette.magenta : tone === 'b' ? palette.cyan : palette.chromeDim;
  const foreground = tone === 'neutral' ? palette.cream : palette.base;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background },
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}>
      {busy ? <ActivityIndicator color={foreground} /> : icon}
      <Text style={[styles.label, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    minHeight: 48,
  },
  label: { fontWeight: '700', letterSpacing: 1.5 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
