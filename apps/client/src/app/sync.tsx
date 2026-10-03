import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SyncProgress } from '@/components/sync-progress';
import { TapeButton } from '@/components/tape-button';
import { fileTransferSupported, useLibrary } from '@/store/library';
import { useSession } from '@/store/session';
import { fonts, layout, palette, radius, spacing } from '@/theme/tokens';

const LASTFM_PRIVACY_URL = 'https://www.last.fm/settings/privacy';

/**
 * First-sync screen. The history is downloaded from Last.fm by this device
 * and kept on it; the tape spools with a percentage while it does. Handles
 * every way that can go wrong: privacy-blocked account, Last.fm errors, an
 * unreachable API, an empty library. The root layout moves the user to /home
 * the moment the library is playable.
 */
export default function SyncScreen() {
  const user = useSession((s) => s.user);
  const apiKey = useSession((s) => s.lastfmApiKey);
  const hydrate = useSession((s) => s.hydrate);
  const signOut = useSession((s) => s.signOut);
  const phase = useLibrary((s) => s.phase);
  const progress = useLibrary((s) => s.progress);
  const snapshot = useLibrary((s) => s.snapshot);
  const lastError = useLibrary((s) => s.lastError);
  const retryImport = useLibrary((s) => s.retry);
  const refresh = useLibrary((s) => s.refresh);
  const loadFile = useLibrary((s) => s.loadFile);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const during = (task: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  const emptyLibrary = phase === 'ready' && snapshot?.scrobbleCount === 0;
  const playable = phase === 'ready' && !emptyLibrary;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.kicker}>FIRST SYNC</Text>
        <Text style={styles.title}>{user?.lastfmUsername ?? '…'}</Text>

        {!apiKey ? (
          <ErrorBlock title="Can't reach the Quiztape API" body="Check that the API is running and reachable, then try again." action="TRY AGAIN" busy={busy} onPress={during(hydrate)} />
        ) : phase === 'privacy_blocked' ? (
          <ErrorBlock
            title="Last.fm is hiding your listening"
            body={'Your Last.fm privacy settings have "Hide recent listening information" turned on, so no history can be read. Turn it off, then retry.'}
            action="RETRY SYNC"
            busy={busy}
            onPress={during(retryImport)}
            link={{ label: 'Open Last.fm privacy settings', url: LASTFM_PRIVACY_URL }}
          />
        ) : phase === 'error' ? (
          <ErrorBlock title="Sync hit a snag" body={`${lastError ?? 'Unknown error.'} What was downloaded so far is kept; retrying carries on from there.`} action="RETRY NOW" busy={busy} onPress={during(retryImport)} />
        ) : emptyLibrary ? (
          <ErrorBlock
            title="No scrobbles found"
            body="This Last.fm account has no listening history yet. Scrobble some music and come back."
            action="CHECK AGAIN"
            busy={busy}
            onPress={during(() => refresh(true))}
          />
        ) : (
          <>
            {phase === 'syncing' ? <SyncProgress progress={progress} /> : <Text style={styles.muted}>Threading the tape…</Text>}
            <Text style={styles.body}>
              {Platform.OS === 'web'
                ? 'Quiztape is rewinding your whole Last.fm history into this browser, where it stays. Big libraries take a few minutes. Keep this tab open; if you leave, it carries on from where it stopped next time.'
                : 'Quiztape is rewinding your whole Last.fm history onto this device, where it stays. Big libraries take a few minutes. Keep the app open; if you leave, it carries on from where it stopped next time.'}
            </Text>
            {fileTransferSupported && phase === 'syncing' ? (
              <Pressable accessibilityRole="button" onPress={() => void loadFile()} style={styles.eject}>
                <Text style={[styles.link, styles.centered]}>Have a Quiztape history file? Load it instead</Text>
              </Pressable>
            ) : null}
            {lastError && phase === 'syncing' ? <Text style={styles.warn}>{lastError}</Text> : null}
          </>
        )}

        <View style={styles.footer}>
          {playable ? <TapeButton label="CONTINUE" onPress={() => router.replace('/home')} /> : null}
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
  centered: { textAlign: 'center' },
  footer: { gap: spacing.md, alignItems: 'center' },
  eject: { padding: spacing.sm },
  ejectLabel: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2 },
});
