import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { layout, palette, radius, spacing } from '@/theme/tokens';

/**
 * The front door. Last.fm login is required to play; there is no guest mode.
 * The real web-auth flow lands in build step 2; this screen only fixes the
 * layout and the copy so all three platforms render the same entry point.
 */
export default function ConnectScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.kicker}>SIDE A: STATS. SIDE B: TRIVIA.</Text>
        <Text style={styles.title} accessibilityRole="header">
          QUIZTAPE
        </Text>
        <Text style={styles.body}>
          A music quiz cut from your own Last.fm history. Connect your account to press play.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          disabled
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
          <Text style={styles.buttonLabel}>CONNECT LAST.FM</Text>
        </Pressable>
        <Text style={styles.footnote}>Sign-in arrives in step 2 of the build.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  kicker: {
    color: palette.cyan,
    fontSize: 12,
    letterSpacing: 2,
  },
  title: {
    color: palette.cream,
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
  },
  body: {
    color: palette.creamMuted,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: palette.magenta,
    opacity: 0.6,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    color: palette.base,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  footnote: {
    color: palette.chrome,
    fontSize: 12,
  },
});
