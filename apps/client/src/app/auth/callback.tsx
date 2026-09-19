import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { describeError } from '@/app/index';
import { useSession } from '@/store/session';
import { palette, spacing } from '@/theme/tokens';

/**
 * Where the API sends the browser after Last.fm: /auth/callback?code=... on
 * web, quiztape://auth/callback?code=... on native. Exchanges the one-time
 * code for a session and moves on. Idempotent: a second visit just goes home.
 */
export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; error?: string }>();
  const router = useRouter();
  const status = useSession((s) => s.status);
  const exchangeCode = useSession((s) => s.exchangeCode);
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (params.error) {
      started.current = true;
      setMessage(describeError(params.error));
      return;
    }
    if (status === 'authenticated' && !params.code) {
      router.replace('/home');
      return;
    }
    if (!params.code) {
      setMessage('This link is missing its sign-in code.');
      return;
    }
    started.current = true;
    exchangeCode(params.code)
      .then(() => router.replace('/home'))
      .catch(() => setMessage('That sign-in code was already used or has expired. Start again.'));
  }, [params.code, params.error, status, exchangeCode, router]);

  return (
    <View style={styles.container}>
      {message ? (
        <>
          <Text style={styles.title}>Tape jammed.</Text>
          <Text style={styles.body}>{message}</Text>
          <Link href="/" style={styles.link}>
            Back to connect
          </Link>
        </>
      ) : (
        <>
          <ActivityIndicator color={palette.magenta} />
          <Text style={styles.body}>Threading the tape…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg, backgroundColor: palette.base },
  title: { color: palette.cream, fontSize: 28, fontWeight: '700' },
  body: { color: palette.creamMuted, textAlign: 'center' },
  link: { color: palette.cyan, marginTop: spacing.md, textDecorationLine: 'underline' },
});
