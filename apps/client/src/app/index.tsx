import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TapeButton } from '@/components/tape-button';
import { ApiError } from '@/lib/api';
import { useSession } from '@/store/session';
import { fonts, layout, palette, radius, spacing } from '@/theme/tokens';

/** The front door: a Last.fm username is all it takes to play. There is no guest mode. */
export default function ConnectScreen() {
  const status = useSession((s) => s.status);
  const signIn = useSession((s) => s.signIn);
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const name = username.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(name);
      router.replace('/sync');
    } catch (e) {
      setError(describeError(e));
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
        <Text style={styles.body}>A music quiz cut from your own Last.fm history. Enter your Last.fm username to press play.</Text>
        <TextInput
          accessibilityLabel="Last.fm username"
          value={username}
          onChangeText={setUsername}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="username"
          textContentType="username"
          maxLength={64}
          placeholder="Last.fm username"
          placeholderTextColor={palette.chrome}
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
          style={styles.input}
        />
        <TapeButton label="LOAD MY TAPE" onPress={() => void onSubmit()} disabled={!username.trim()} busy={busy || status === 'loading'} style={styles.button} />
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : (
          <Text style={styles.footnote}>No password and no Last.fm login: Quiztape only reads what your Last.fm profile already shows.</Text>
        )}
        <View style={styles.legal}>
          <Link href="/privacy" style={styles.legalLink}>
            Privacy
          </Link>
          <Link href="/terms" style={styles.legalLink}>
            Terms
          </Link>
        </View>
      </View>
    </SafeAreaView>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network_error') return 'Quiztape cannot be reached right now. Check your connection and try again.';
    // The API words these for the player, naming the username where it matters.
    if (error.code === 'user_not_found' || error.code === 'lastfm_unreachable' || error.code === 'invalid_body') return error.message;
  }
  return 'Sign-in failed. Try again.';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.base, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', maxWidth: layout.maxContentWidth, paddingHorizontal: spacing.lg, gap: spacing.md, alignItems: 'center' },
  kicker: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 2 },
  title: { color: palette.cream, fontFamily: fonts.display, fontSize: 64, letterSpacing: 4, textAlign: 'center' },
  body: { color: palette.creamMuted, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  input: {
    width: '100%',
    maxWidth: 360,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: palette.chromeDim,
    borderRadius: radius.md,
    padding: spacing.md,
    color: palette.cream,
    fontFamily: fonts.mono,
    fontSize: 18,
    textAlign: 'center',
    backgroundColor: palette.baseElevated,
  },
  button: { marginTop: spacing.xs },
  footnote: { color: palette.chrome, fontSize: 12, textAlign: 'center' },
  error: { color: palette.wrong, fontSize: 14, textAlign: 'center' },
  legal: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.lg },
  legalLink: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, textDecorationLine: 'underline' },
});
