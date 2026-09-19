import { type Difficulty, DIFFICULTIES, type QuizMode, ROUND_LENGTHS, type RoundLength, type RoundStateDto, type SyncSummary } from '@quiztape/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SyncProgress } from '@/components/sync-progress';
import { TapeButton } from '@/components/tape-button';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/store/session';
import { fonts, layout, palette, radius, spacing } from '@/theme/tokens';

const MODES: { key: QuizMode; title: string; subtitle: string; tone: string; available: boolean }[] = [
  { key: 'side_a', title: 'SIDE A', subtitle: 'Your stats', tone: palette.magenta, available: true },
  { key: 'side_b', title: 'SIDE B', subtitle: 'Band trivia · step 4', tone: palette.cyan, available: false },
  { key: 'mixtape', title: 'FULL MIXTAPE', subtitle: 'Both sides · step 5', tone: palette.cream, available: false },
  { key: 'bracket', title: 'BRACKET', subtitle: 'Tournament · step 6', tone: palette.chrome, available: false },
];

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', deep_cut: 'Deep cut' };

export default function HomeScreen() {
  const user = useSession((s) => s.user);
  const token = useSession((s) => s.token);
  const signOut = useSession((s) => s.signOut);
  const router = useRouter();
  const [sync, setSync] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [mode, setMode] = useState<QuizMode>('side_a');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [length, setLength] = useState<RoundLength>(10);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

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
        const active = next.phase === 'pending' || next.phase === 'backfilling' || (next.phase === 'complete' && !next.statsBuiltAt);
        timer = setTimeout(poll, active ? 2_500 : 60_000);
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

  const ready = sync?.phase === 'complete' && sync.scrobbleCount > 0 && sync.statsBuiltAt !== null;

  const start = async () => {
    if (!token) return;
    setStarting(true);
    setStartError(null);
    try {
      const state = await api<RoundStateDto>('/v1/rounds', { method: 'POST', token, body: { mode, difficulty, length } });
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

        {sync ? <SyncProgress sync={sync} /> : <Text style={styles.muted}>{syncError ?? 'Checking your tape…'}</Text>}

        <Text style={styles.sectionTitle}>PICK A SIDE</Text>
        <View style={styles.modes}>
          {MODES.map((m) => {
            const selected = mode === m.key;
            return (
              <Pressable
                key={m.key}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !m.available }}
                disabled={!m.available}
                onPress={() => setMode(m.key)}
                style={[styles.modeCard, { borderColor: selected ? m.tone : palette.chromeDim }, !m.available && styles.modeDisabled]}>
                <Text style={[styles.modeTitle, { color: m.tone }]}>{m.title}</Text>
                <Text style={styles.modeSubtitle}>{m.subtitle}</Text>
              </Pressable>
            );
          })}
        </View>

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

        <TapeButton label={ready ? 'PRESS PLAY' : 'WAITING FOR TAPE'} onPress={() => void start()} disabled={!ready} busy={starting} />
        {startError ? <Text style={styles.error}>{startError}</Text> : null}
        <Text style={styles.muted}>{ready ? 'One question at a time. The reels stop when the timer runs out.' : 'Modes unlock once your history is on tape.'}</Text>

        <Pressable accessibilityRole="link" onPress={() => user?.lastfmUrl && void Linking.openURL(user.lastfmUrl)} style={styles.attribution}>
          <Text style={styles.attributionText}>Listening data from Last.fm · powered by AudioScrobbler</Text>
        </Pressable>
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
});
