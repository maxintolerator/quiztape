import { isLibraryReady } from '@quiztape/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SyncProgress } from '@/components/sync-progress';
import { TapeButton } from '@/components/tape-button';
import { useSession } from '@/store/session';
import { fonts, layout, palette, radius, spacing } from '@/theme/tokens';

const LASTFM_PRIVACY_URL = 'https://www.last.fm/settings/privacy';

/**
 * First-sync screen. Polls the sync state every 2.5 s, shows the tape
 * spooling with a percentage, and handles every way it can go wrong:
 * privacy-blocked account, sync errors, an unreachable API, an empty library.
 * The root layout moves the user to /home the moment the library is ready.
 */
export default function SyncScreen() {
  const user = useSession((s) => s.user);
  const sync = useSession((s) => s.sync);
  const refreshSync = useSession((s) => s.refreshSync);
  const requestSync = useSession((s) => s.requestSync);
  const signOut = useSession((s) => s.signOut);
  const router = useRouter();
  const [unreachable, setUnreachable] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const next = await refreshSync();
      if (cancelled) return;
      setUnreachable(next === null);
      if (next && isLibraryReady(next)) return; // the auth gate navigates away
      const active = !next || next.phase === 'pending' || next.phase === 'backfilling' || (next.phase === 'complete' && !next.statsBuiltAt);
      timer = setTimeout(poll, active ? 2_500 : 15_000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshSync]);

  const retry = async () => {
    setRetrying(true);
    try {
      await requestSync();
      await refreshSync();
    } catch {
      setUnreachable(true);
    } finally {
      setRetrying(false);
    }
  };

  const phase = sync?.phase ?? 'pending';
  const emptyLibrary = sync?.phase === 'complete' && sync.scrobbleCount === 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.kicker}>FIRST SYNC</Text>
        <Text style={styles.title}>{user?.lastfmUsername ?? '…'}</Text>

        {unreachable && !sync ? (
          <ErrorBlock title="Can't reach the Quiztape API" body="Check that the API is running and reachable, then try again." action="TRY AGAIN" busy={retrying} onPress={retry} />
        ) : phase === 'privacy_blocked' ? (
          <ErrorBlock
            title="Last.fm is hiding your listening"
            body={'Your Last.fm privacy settings have "Hide recent listening information" turned on, so no history can be read. Turn it off, then retry.'}
            action="RETRY SYNC"
            busy={retrying}
            onPress={retry}
            link={{ label: 'Open Last.fm privacy settings', url: LASTFM_PRIVACY_URL }}
          />
        ) : phase === 'error' ? (
          <ErrorBlock title="Sync hit a snag" body={sync?.lastError ?? 'Unknown error. It will retry automatically.'} action="RETRY NOW" busy={retrying} onPress={retry} />
        ) : emptyLibrary ? (
          <ErrorBlock
            title="No scrobbles found"
            body="This Last.fm account has no listening history yet. Scrobble some music and come back; the tape will fill up on its own."
            action="CHECK AGAIN"
            busy={retrying}
            onPress={retry}
          />
        ) : (
          <>
            {sync ? <SyncProgress sync={sync} /> : <Text style={styles.muted}>Threading the tape…</Text>}
            <Text style={styles.body}>
              Quiztape is rewinding your whole Last.fm history so questions can be cut from it. Big libraries take a few minutes; you can leave this open or come back later, it keeps going.
            </Text>
            {unreachable ? <Text style={styles.warn}>Lost contact with the API, retrying…</Text> : null}
          </>
        )}

        <View style={styles.footer}>
          {sync && isLibraryReady(sync) ? <TapeButton label="CONTINUE" onPress={() => router.replace('/home')} /> : null}
          <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.eject}>
            <Text style={styles.ejectLabel}>EJECT</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function ErrorBlock({ title, body, action, busy, onPress, link }: { title: string; body: string; action: string; busy: boolean; onPress: () => void; link?: { label: string; url: string } }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {link ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(link.url)}>
          <Text style={styles.link}>{link.label}</Text>
        </Pressable>
      ) : null}
      <TapeButton label={action} tone="b" busy={busy} onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.base },
  content: { flex: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg, justifyContent: 'center' },
  kicker: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2, textAlign: 'center' },
  title: { color: palette.cream, fontFamily: fonts.display, fontSize: 32, letterSpacing: 1, textAlign: 'center' },
  body: { color: palette.creamMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  muted: { color: palette.chrome, fontFamily: fonts.mono, textAlign: 'center' },
  warn: { color: palette.wrong, fontFamily: fonts.mono, fontSize: 12, textAlign: 'center' },
  errorBox: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.wrong, backgroundColor: palette.baseElevated, alignItems: 'center' },
  errorTitle: { color: palette.cream, fontFamily: fonts.display, fontSize: 22, letterSpacing: 1, textAlign: 'center' },
  link: { color: palette.cyan, textDecorationLine: 'underline', fontFamily: fonts.mono, fontSize: 13 },
  footer: { gap: spacing.md, alignItems: 'center' },
  eject: { padding: spacing.sm },
  ejectLabel: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2 },
});
