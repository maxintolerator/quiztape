import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TapeButton } from '@/components/tape-button';
import { startConnect } from '@/lib/connect';
import { useSession } from '@/store/session';
import { fonts, layout, palette, spacing } from '@/theme/tokens';

/** The front door. Last.fm login is required to play; there is no guest mode. */
export default function ConnectScreen() {
  const status = useSession((s) => s.status);
  const exchangeCode = useSession((s) => s.exchangeCode);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await startConnect();
      if (result.type === 'code') {
        await exchangeCode(result.code);
        router.replace('/home');
      } else if (result.type === 'error') {
        setError(describeError(result.error));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

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
        <TapeButton label="CONNECT LAST.FM" onPress={onConnect} busy={busy || status === 'loading'} style={styles.button} />
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : (
          <Text style={styles.footnote}>
            {Platform.OS === 'web' ? 'You will be sent to Last.fm and straight back.' : 'Opens Last.fm in a secure browser sheet.'}
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

export function describeError(code: string): string {
  switch (code) {
    case 'denied':
      return 'Last.fm did not grant access. Try again when you are ready.';
    case 'expired':
    case 'already_used':
      return 'That sign-in link expired. Press connect to start a fresh one.';
    case 'lastfm_14':
      return 'Last.fm says the request was not authorised. Try again.';
    case 'lastfm_15':
      return 'Last.fm took too long to return. Try again.';
    default:
      return code.startsWith('lastfm_') ? `Last.fm returned an error (${code.slice(7)}). Try again in a minute.` : 'Sign-in failed. Try again.';
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.base, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', maxWidth: layout.maxContentWidth, paddingHorizontal: spacing.lg, gap: spacing.md, alignItems: 'center' },
  kicker: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 2 },
  title: { color: palette.cream, fontFamily: fonts.display, fontSize: 64, letterSpacing: 4, textAlign: 'center' },
  body: { color: palette.creamMuted, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  button: { marginTop: spacing.md },
  footnote: { color: palette.chrome, fontSize: 12, textAlign: 'center' },
  error: { color: palette.wrong, fontSize: 14, textAlign: 'center' },
});
