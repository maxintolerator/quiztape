import type { SyncSummary } from '@quiztape/shared';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SyncProgress } from '@/components/sync-progress';
import { api } from '@/lib/api';
import { useSession } from '@/store/session';
import { layout, palette, radius, spacing } from '@/theme/tokens';

const MODES = [
  { key: 'side_a', title: 'SIDE A', subtitle: 'Your stats', tone: palette.magenta },
  { key: 'side_b', title: 'SIDE B', subtitle: 'Band trivia', tone: palette.cyan },
  { key: 'mixtape', title: 'FULL MIXTAPE', subtitle: 'Both sides', tone: palette.cream },
  { key: 'bracket', title: 'BRACKET', subtitle: 'Top-artist tournament', tone: palette.chrome },
] as const;

export default function HomeScreen() {
  const user = useSession((s) => s.user);
  const token = useSession((s) => s.token);
  const signOut = useSession((s) => s.signOut);
  const [sync, setSync] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Poll while the first sync runs; once complete, ask for an incremental refresh once.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let refreshed = false;
    const poll = async () => {
      try {
        const next = await api<SyncSummary>('/v1/me/sync', { token });
        if (cancelled) return;
        setSync(next);
        setSyncError(null);
        if (next.phase === 'complete' && !refreshed) {
          refreshed = true;
          void api('/v1/me/sync/refresh', { method: 'POST', token }).catch(() => undefined);
        }
        const active = next.phase === 'pending' || next.phase === 'backfilling';
        timer = setTimeout(poll, active ? 2_500 : 30_000);
      } catch (error) {
        if (cancelled) return;
        setSyncError(error instanceof Error ? error.message : 'Could not reach the API');
        timer = setTimeout(poll, 5_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  const ready = sync?.phase === 'complete' && sync.scrobbleCount > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>NOW PLAYING FOR</Text>
            <Text style={styles.username}>{user?.lastfmUsername ?? '…'}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => void signOut()} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
            <Text style={styles.signOutLabel}>Eject</Text>
          </Pressable>
        </View>

        {sync ? <SyncProgress sync={sync} /> : <Text style={styles.muted}>{syncError ?? 'Checking your tape…'}</Text>}

        <Text style={styles.sectionTitle}>PICK A SIDE</Text>
        <View style={styles.modes}>
          {MODES.map((mode) => (
            <Pressable
              key={mode.key}
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              disabled
              style={[styles.modeCard, { borderColor: mode.tone }, !ready && styles.modeDisabled]}>
              <Text style={[styles.modeTitle, { color: mode.tone }]}>{mode.title}</Text>
              <Text style={styles.modeSubtitle}>{mode.subtitle}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.muted}>{ready ? 'Rounds arrive in build step 3.' : 'Modes unlock once your history is on tape.'}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.base },
  content: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { color: palette.cyan, fontSize: 11, letterSpacing: 2 },
  username: { color: palette.cream, fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  signOut: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.chromeDim },
  signOutLabel: { color: palette.creamMuted, letterSpacing: 1 },
  pressed: { opacity: 0.8 },
  sectionTitle: { color: palette.creamMuted, fontSize: 12, letterSpacing: 2 },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  modeCard: { flexBasis: '47%', flexGrow: 1, minWidth: 140, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, backgroundColor: palette.baseElevated, gap: spacing.xs },
  modeDisabled: { opacity: 0.45 },
  modeTitle: { fontSize: 18, fontWeight: '800', letterSpacing: 1.5 },
  modeSubtitle: { color: palette.creamMuted, fontSize: 13 },
  muted: { color: palette.chrome, fontSize: 12, textAlign: 'center' },
});
