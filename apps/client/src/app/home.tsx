import {
  BRACKET_SIZES,
  type BracketSize,
  type BracketStateDto,
  type Difficulty,
  DIFFICULTIES,
  type QuizMode,
  ROUND_LENGTHS,
  type RoundLength,
  type RoundStateDto,
  type TriviaSummary,
  triviaArtistsOf,
} from '@quiztape/shared';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SupportLink } from '@/components/support-link';
import { TapeButton } from '@/components/tape-button';
import { api, ApiError } from '@/lib/api';
import { fileTransferSupported, useLibrary } from '@/store/library';
import { useSession } from '@/store/session';
import { fonts, layout, palette, radius, spacing } from '@/theme/tokens';

const MODES: { key: QuizMode; title: string; subtitle: string; tone: string }[] = [
  { key: 'side_a', title: 'SIDE A', subtitle: 'Your stats', tone: palette.magenta },
  { key: 'side_b', title: 'SIDE B', subtitle: 'Band trivia', tone: palette.cyan },
  { key: 'mixtape', title: 'FULL MIXTAPE', subtitle: 'Both sides', tone: palette.cream },
  { key: 'bracket', title: 'BRACKET', subtitle: 'Top-artist tournament', tone: palette.cream },
];

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', deep_cut: 'Deep cut' };

export default function HomeScreen() {
  const user = useSession((s) => s.user);
  const token = useSession((s) => s.token);
  const signOut = useSession((s) => s.signOut);
  const expire = useSession((s) => s.expire);
  const snapshot = useLibrary((s) => s.snapshot);
  const refreshing = useLibrary((s) => s.refreshing);
  const persistent = useLibrary((s) => s.persistent);
  const libraryError = useLibrary((s) => s.lastError);
  const refreshLibrary = useLibrary((s) => s.refresh);
  const downloadHistory = useLibrary((s) => s.download);
  const loadHistoryFile = useLibrary((s) => s.loadFile);
  const eraseLibrary = useLibrary((s) => s.erase);
  const router = useRouter();
  const [trivia, setTrivia] = useState<TriviaSummary | null>(null);
  const [mode, setMode] = useState<QuizMode>('side_a');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [length, setLength] = useState<RoundLength>(10);
  const [bracketSize, setBracketSize] = useState<BracketSize>(16);
  const [starting, setStarting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Tell the API which artists to load band facts for (it keeps nothing else about the library), then poll while they load.
  useEffect(() => {
    if (!token || !snapshot) return;
    const artists = triviaArtistsOf(snapshot);
    const artistKeys = snapshot.artists.slice(0, artists.length).map((a) => a.key);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = async (path: string, body: unknown) => {
      try {
        const next = await api<TriviaSummary>(path, { method: 'POST', token, body });
        if (cancelled) return;
        setTrivia(next);
        if (!next.ready && next.running) timer = setTimeout(() => void ask('/v1/me/trivia', { artistKeys }), 5_000);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) void expire();
        else timer = setTimeout(() => void ask('/v1/me/trivia', { artistKeys }), 15_000);
      }
    };
    void ask('/v1/me/library', { artists });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, snapshot, expire]);

  const ready = (snapshot?.scrobbleCount ?? 0) > 0;
  const triviaReady = !!trivia?.ready;
  const modeAvailable = (key: QuizMode) => (key === 'side_a' || key === 'bracket' ? ready : ready && triviaReady);
  const triviaStatus = trivia
    ? triviaReady
      ? `${trivia.readyArtists} of ${trivia.eligibleArtists} artists have band facts loaded`
      : trivia.running
        ? `Loading band facts: ${trivia.readyArtists} of ${trivia.eligibleArtists} artists ready`
        : `Band facts could not be loaded for enough artists yet (${trivia.readyArtists} of ${trivia.eligibleArtists}).`
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
    await eraseLibrary();
    await signOut();
  };

  const effectiveMode: QuizMode = modeAvailable(mode) ? mode : 'side_a';

  const start = async () => {
    if (!token || !snapshot) return;
    setStarting(true);
    setStartError(null);
    try {
      if (effectiveMode === 'bracket') {
        const state = await api<BracketStateDto>('/v1/brackets', { method: 'POST', token, body: { size: bracketSize, stats: snapshot } });
        router.push({ pathname: '/bracket/[bracketId]', params: { bracketId: state.bracket.id } });
        return;
      }
      const state = await api<RoundStateDto>('/v1/rounds', { method: 'POST', token, body: { mode: effectiveMode, difficulty, length, stats: snapshot } });
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
            {snapshot ? `${snapshot.scrobbleCount.toLocaleString()} scrobbles on tape` : 'Checking your tape…'}
            {snapshot?.newestPlayedAt ? ` · latest ${new Date(snapshot.newestPlayedAt * 1000).toLocaleDateString()}` : ''}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void refreshLibrary(true)} disabled={refreshing} style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
            <Text style={styles.refreshLabel}>{refreshing ? 'SYNCING…' : 'REFRESH'}</Text>
          </Pressable>
        </View>

        {libraryError ? <Text style={styles.error}>{libraryError}</Text> : null}
        {!persistent ? <Text style={styles.muted}>This browser would not store your history, so it is kept for this tab only and will be downloaded again next time.</Text> : null}

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

        {effectiveMode === 'bracket' ? (
          <>
            <Text style={styles.sectionTitle}>BRACKET SIZE</Text>
            <View style={styles.chips}>
              {BRACKET_SIZES.map((n) => (
                <Chip key={n} label={`Top ${n}`} selected={bracketSize === n} onPress={() => setBracketSize(n)} />
              ))}
            </View>
            <Text style={styles.muted}>Each match: guess which artist you played more, then choose who advances.</Text>
          </>
        ) : (
          <>
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
          </>
        )}

        <TapeButton label={ready ? 'PRESS PLAY' : 'WAITING FOR TAPE'} tone={effectiveMode === 'side_b' ? 'b' : 'a'} onPress={() => void start()} disabled={!ready} busy={starting} />
        {startError ? <Text style={styles.error}>{startError}</Text> : null}
        <Text style={styles.muted}>{ready ? (effectiveMode === 'bracket' ? 'Seeded from your most played artists.' : 'One question at a time. The reels stop when the timer runs out.') : 'Modes unlock once your history is on tape.'}</Text>

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
          <SupportLink compact />
          {fileTransferSupported ? (
            <>
              <Pressable accessibilityRole="button" onPress={() => void downloadHistory()}>
                <Text style={styles.footerLink}>Download my history</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void loadHistoryFile()} disabled={refreshing}>
                <Text style={styles.footerLink}>Load a history file</Text>
              </Pressable>
            </>
          ) : null}
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
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: spacing.lg },
  footerLink: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 11, textDecorationLine: 'underline' },
  danger: { color: palette.wrong },
});
