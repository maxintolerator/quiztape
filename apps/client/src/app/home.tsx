import { type Difficulty, DIFFICULTIES, isLibraryReady, type QuizMode, ROUND_LENGTHS, type RoundLength, type RoundStateDto } from '@quiztape/shared';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TapeButton } from '@/components/tape-button';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/store/session';
import { fonts, layout, palette, radius, spacing } from '@/theme/tokens';

const MODES: { key: QuizMode; title: string; subtitle: string; tone: string }[] = [
  { key: 'side_a', title: 'SIDE A', subtitle: 'Your stats', tone: palette.magenta },
  { key: 'side_b', title: 'SIDE B', subtitle: 'Band trivia', tone: palette.cyan },
  { key: 'mixtape', title: 'FULL MIXTAPE', subtitle: 'Both sides', tone: palette.cream },
  { key: 'bracket', title: 'BRACKET', subtitle: 'Tournament · step 6', tone: palette.chrome },
];

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', deep_cut: 'Deep cut' };

export default function HomeScreen() {
  const user = useSession((s) => s.user);
  const token = useSession((s) => s.token);
  const sync = useSession((s) => s.sync);
  const refreshSync = useSession((s) => s.refreshSync);
  const requestSync = useSession((s) => s.requestSync);
  const signOut = useSession((s) => s.signOut);
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<QuizMode>('side_a');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [length, setLength] = useState<RoundLength>(10);
  const [starting, setStarting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Ask for anything new since the last sync once per visit, then keep polling while band facts load.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const next = await refreshSync();
      if (cancelled) return;
      if (next && !next.trivia.ready) timer = setTimeout(poll, 5_000);
    };
    void requestSync()
      .catch(() => undefined)
      .then(poll);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, requestSync, refreshSync]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await requestSync();
      await refreshSync();
    } finally {
      setRefreshing(false);
    }
  };

  const ready = isLibraryReady(sync) && (sync?.scrobbleCount ?? 0) > 0;
  const trivia = sync?.trivia ?? null;
  const triviaReady = !!trivia?.ready;
  const modeAvailable = (key: QuizMode) => (key === 'side_a' ? ready : key === 'bracket' ? false : ready && triviaReady);
  const triviaStatus = trivia
    ? triviaReady
      ? `${trivia.readyArtists} of ${trivia.eligibleArtists} artists have band facts loaded`
      : trivia.running
        ? `Loading band facts: ${trivia.readyArtists} of ${trivia.eligibleArtists} artists ready`
        : `Band facts not loaded yet (${trivia.readyArtists} of ${trivia.eligibleArtists}). Refresh to start.`
    : null;

  const deleteAccount = async () => {
    if (!token) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 6_000);
      return;
    }
    setDeleting(true);
    try {
      await api('/v1/me', { method: 'DELETE', token });
    } catch {
      // fall through: the local session is cleared either way
    }
    await signOut();
  };

  const effectiveMode: QuizMode = modeAvailable(mode) ? mode : 'side_a';

  const start = async () => {
    if (!token) return;
    setStarting(true);
    setStartError(null);
    try {
      const state = await api<RoundStateDto>('/v1/rounds', { method: 'POST', token, body: { mode: effectiveMode, difficulty, length } });
      router.push({ pathname: '/play/[roundId]', params: { roundId: state.round.id } });
    } catch (error) {
      setStartError(error instanceof ApiError ? error.message : 'Could not start a round');
    } finally {
      setStarting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>NOW PLAYING FOR</Text>
            <Text style={styles.username}>{user?.lastfmUsername ?? '…'}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => void signOut()} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
            <Text style={styles.signOutLabel}>EJECT</Text>
          </Pressable>
        </View>

        <View style={styles.libraryRow}>
          <Text style={styles.libraryText}>
            {sync ? `${sync.scrobbleCount.toLocaleString()} scrobbles on tape` : 'Checking your tape…'}
            {sync?.newestPlayedAt ? ` · latest ${new Date(sync.newestPlayedAt).toLocaleDateString()}` : ''}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void refresh()} disabled={refreshing} style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
            <Text style={styles.refreshLabel}>{refreshing ? 'SYNCING…' : 'REFRESH'}</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>PICK A SIDE</Text>
        <View style={styles.modes}>
          {MODES.map((m) => {
            const selected = mode === m.key;
            const available = modeAvailable(m.key);
            return (
              <Pressable
                key={m.key}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !available }}
                disabled={!available}
                onPress={() => setMode(m.key)}
                style={[styles.modeCard, { borderColor: selected ? m.tone : palette.chromeDim }, !available && styles.modeDisabled]}>
                <Text style={[styles.modeTitle, { color: m.tone }]}>{m.title}</Text>
                <Text style={styles.modeSubtitle}>{m.subtitle}</Text>
              </Pressable>
            );
          })}
        </View>
        {triviaStatus ? <Text style={styles.muted}>{triviaStatus}</Text> : null}

        <Text style={styles.sectionTitle}>DIFFICULTY</Text>
        <View style={styles.chips}>
          {DIFFICULTIES.map((d) => (
            <Chip key={d} label={DIFFICULTY_LABEL[d]} selected={difficulty === d} onPress={() => setDifficulty(d)} />
          ))}
        </View>

        <Text style={styles.sectionTitle}>ROUND LENGTH</Text>
        <View style={styles.chips}>
          {ROUND_LENGTHS.map((n) => (
            <Chip key={n} label={`${n} questions`} selected={length === n} onPress={() => setLength(n)} />
          ))}
        </View>

        <TapeButton label={ready ? 'PRESS PLAY' : 'WAITING FOR TAPE'} tone={effectiveMode === 'side_b' ? 'b' : 'a'} onPress={() => void start()} disabled={!ready} busy={starting} />
        {startError ? <Text style={styles.error}>{startError}</Text> : null}
        <Text style={styles.muted}>{ready ? 'One question at a time. The reels stop when the timer runs out.' : 'Modes unlock once your history is on tape.'}</Text>

        <Pressable accessibilityRole="link" onPress={() => user?.lastfmUrl && void Linking.openURL(user.lastfmUrl)} style={styles.attribution}>
          <Text style={styles.attributionText}>Listening data from Last.fm · powered by AudioScrobbler</Text>
        </Pressable>

        <View style={styles.footerLinks}>
          <Link href="/privacy" style={styles.footerLink}>
            Privacy
          </Link>
          <Link href="/terms" style={styles.footerLink}>
            Terms
          </Link>
          <Pressable accessibilityRole="button" onPress={() => void deleteAccount()} disabled={deleting}>
            <Text style={[styles.footerLink, confirmDelete && styles.danger]}>{deleting ? 'Deleting…' : confirmDelete ? 'Press again to delete everything' : 'Delete my account and data'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.base },
  content: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2 },
  username: { color: palette.cream, fontFamily: fonts.display, fontSize: 32, letterSpacing: 1 },
  signOut: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.chromeDim },
  signOutLabel: { color: palette.creamMuted, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2 },
  pressed: { opacity: 0.8 },
  libraryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.baseElevated, borderWidth: 1, borderColor: palette.chromeDim },
  libraryText: { color: palette.creamMuted, fontFamily: fonts.mono, fontSize: 12, flex: 1 },
  refresh: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  refreshLabel: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2 },
  sectionTitle: { color: palette.creamMuted, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 2 },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  modeCard: { flexBasis: '47%', flexGrow: 1, minWidth: 140, padding: spacing.md, borderRadius: radius.lg, borderWidth: 2, backgroundColor: palette.baseElevated, gap: spacing.xs },
  modeDisabled: { opacity: 0.45 },
  modeTitle: { fontFamily: fonts.display, fontSize: 20, letterSpacing: 1.5 },
  modeSubtitle: { color: palette.creamMuted, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.chromeDim },
  chipSelected: { borderColor: palette.cream, backgroundColor: palette.baseElevated },
  chipLabel: { color: palette.creamMuted, fontFamily: fonts.mono, fontSize: 12 },
  chipLabelSelected: { color: palette.cream },
  muted: { color: palette.chrome, fontSize: 12, textAlign: 'center' },
  error: { color: palette.wrong, fontSize: 13, textAlign: 'center' },
  attribution: { alignSelf: 'center', padding: spacing.sm },
  attributionText: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 11 },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.lg },
  footerLink: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 11, textDecorationLine: 'underline' },
  danger: { color: palette.wrong },
});
