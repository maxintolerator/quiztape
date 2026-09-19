import { type BracketEntrantDto, type BracketMatchDto, type BracketStateDto, type DuelResultDto, roundName } from '@quiztape/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SupportLink } from '@/components/support-link';
import { TapeButton } from '@/components/tape-button';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/store/session';
import { fonts, layout, palette, radius, spacing } from '@/theme/tokens';

/**
 * The tournament. Each match has two beats: guess which artist you played
 * more (scored), then choose who advances (your call). Below the match the
 * whole bracket renders as a tracklist, round by round.
 */
export default function BracketScreen() {
  const { bracketId } = useLocalSearchParams<{ bracketId: string }>();
  const token = useSession((s) => s.token);
  const router = useRouter();
  const [state, setState] = useState<BracketStateDto | null>(null);
  const [duel, setDuel] = useState<DuelResultDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !bracketId) return;
    api<BracketStateDto>(`/v1/brackets/${bracketId}`, { token })
      .then((s) => {
        setState(s);
        // Resuming mid-match after the duel was answered: show the pick step without the reveal.
        if (s.current?.duelGuessSeed !== null && s.current?.duelGuessSeed !== undefined) setDuel(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the bracket'));
  }, [token, bracketId]);

  const entrant = useCallback((seed: number | null): BracketEntrantDto | null => state?.entrants.find((e) => e.seed === seed) ?? null, [state]);

  const answerDuel = async (seed: number) => {
    if (!token || !state?.current || busy) return;
    setBusy(true);
    try {
      const result = await api<DuelResultDto>(`/v1/brackets/${state.bracket.id}/matches/${state.current.id}/duel`, { method: 'POST', token, body: { seed } });
      setDuel(result);
      setState({ ...state, bracket: result.bracket, current: result.match, matches: state.matches.map((m) => (m.id === result.match.id ? result.match : m)) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit the duel');
    } finally {
      setBusy(false);
    }
  };

  const pick = async (seed: number) => {
    if (!token || !state?.current || busy) return;
    setBusy(true);
    try {
      const next = await api<BracketStateDto>(`/v1/brackets/${state.bracket.id}/matches/${state.current.id}/pick`, { method: 'POST', token, body: { seed } });
      setState(next);
      setDuel(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit the pick');
    } finally {
      setBusy(false);
    }
  };

  const current = state?.current ?? null;
  const duelAnswered = current?.duelGuessSeed !== null && current?.duelGuessSeed !== undefined;
  const a = entrant(current?.seedA ?? null);
  const b = entrant(current?.seedB ?? null);
  const champion = state?.bracket.championSeed ? entrant(state.bracket.championSeed) : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!state && !error ? <Text style={styles.muted}>Seeding the bracket…</Text> : null}

        {state && current && a && b ? (
          <>
            <Text style={styles.kicker}>
              {roundName(current.roundNo, state.bracket.roundCount).toUpperCase()} · MATCH {current.matchNo + 1} OF {state.bracket.size / 2 ** current.roundNo}
            </Text>
            <Text style={styles.prompt}>{duelAnswered ? 'Who advances?' : 'Which one have you played more?'}</Text>
            <View style={styles.matchRow}>
              {[a, b].map((e) => {
                const isGuess = duel?.match.duelGuessSeed === e.seed;
                const isMore = duel?.morePlayedSeed === e.seed;
                return (
                  <Pressable
                    key={e.seed}
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => (duelAnswered ? void pick(e.seed) : void answerDuel(e.seed))}
                    style={({ pressed }) => [
                      styles.artistCard,
                      pressed && styles.pressed,
                      duel && isMore && styles.more,
                      duel && isGuess && !isMore && styles.wrongGuess,
                    ]}>
                    <Text style={styles.seed}>#{e.seed}</Text>
                    <Text style={styles.artist}>{e.artistName}</Text>
                    {duel ? <Text style={styles.plays}>{(e.seed === current.seedA ? duel.playsA : duel.playsB).toLocaleString()} plays</Text> : null}
                  </Pressable>
                );
              })}
            </View>
            {duel ? (
              <Text style={[styles.verdict, { color: duel.correct ? palette.correct : palette.wrong }]}>
                {duel.correct ? 'CORRECT' : 'NOT QUITE'} · duels {state.bracket.duelsCorrect}/{state.bracket.duelsTotal} · now tap who goes through
              </Text>
            ) : duelAnswered ? (
              <Text style={styles.muted}>Duel already answered. Tap who goes through.</Text>
            ) : null}
          </>
        ) : null}

        {state && state.bracket.status === 'completed' && champion ? (
          <View style={styles.card}>
            <Text style={styles.cardKicker}>CHAMPION</Text>
            <Text style={styles.champion}>{champion.artistName}</Text>
            <Text style={styles.cardSub}>
              Seed #{champion.seed} · duels {state.bracket.duelsCorrect}/{state.bracket.duelsTotal} correct
            </Text>
            <TapeButton label="PLAY ANOTHER" onPress={() => router.replace('/home')} style={styles.cardButton} />
            <SupportLink />
          </View>
        ) : null}

        {state ? (
          <>
            <Text style={styles.sectionTitle}>THE BRACKET</Text>
            {Array.from({ length: state.bracket.roundCount }, (_, i) => i + 1).map((roundNo) => (
              <View key={roundNo} style={styles.round}>
                <Text style={styles.roundName}>{roundName(roundNo, state.bracket.roundCount)}</Text>
                {state.matches
                  .filter((m) => m.roundNo === roundNo)
                  .map((m) => (
                    <MatchLine key={m.id} match={m} entrant={entrant} isCurrent={current?.id === m.id} />
                  ))}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MatchLine({ match, entrant, isCurrent }: { match: BracketMatchDto; entrant: (seed: number | null) => BracketEntrantDto | null; isCurrent: boolean }) {
  const a = entrant(match.seedA);
  const b = entrant(match.seedB);
  const name = (e: BracketEntrantDto | null) => (e ? `${e.artistName}` : '—');
  return (
    <View style={[styles.matchLine, isCurrent && styles.matchLineCurrent]}>
      <Text style={[styles.lineText, match.winnerSeed === match.seedA && styles.winner, match.winnerSeed !== null && match.winnerSeed !== match.seedA && styles.loser]}>{name(a)}</Text>
      <Text style={styles.vs}>{match.duelCorrect === null ? 'vs' : match.duelCorrect ? '✓' : '✗'}</Text>
      <Text style={[styles.lineText, styles.right, match.winnerSeed === match.seedB && styles.winner, match.winnerSeed !== null && match.winnerSeed !== match.seedB && styles.loser]}>{name(b)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.base },
  content: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', padding: spacing.lg, gap: spacing.md },
  kicker: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2, textAlign: 'center' },
  prompt: { color: palette.cream, fontFamily: fonts.marker, fontSize: 24, textAlign: 'center' },
  matchRow: { flexDirection: 'row', gap: spacing.md },
  artistCard: { flex: 1, padding: spacing.md, borderRadius: radius.lg, borderWidth: 2, borderColor: palette.chromeDim, backgroundColor: palette.baseElevated, gap: spacing.xs, minHeight: 120, justifyContent: 'center' },
  pressed: { opacity: 0.85 },
  more: { borderColor: palette.correct },
  wrongGuess: { borderColor: palette.wrong },
  seed: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 11 },
  artist: { color: palette.cream, fontFamily: fonts.display, fontSize: 22, letterSpacing: 0.5 },
  plays: { color: palette.creamMuted, fontFamily: fonts.mono, fontSize: 12 },
  verdict: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1, textAlign: 'center' },
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: palette.cream, gap: spacing.xs, alignItems: 'center' },
  cardKicker: { color: palette.magenta, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2 },
  champion: { color: palette.base, fontFamily: fonts.display, fontSize: 40, textAlign: 'center' },
  cardSub: { color: palette.chromeDim, fontFamily: fonts.mono, fontSize: 12 },
  cardButton: { marginTop: spacing.md },
  sectionTitle: { color: palette.creamMuted, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 2, marginTop: spacing.md },
  round: { gap: spacing.xs },
  roundName: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.5, marginTop: spacing.sm },
  matchLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  matchLineCurrent: { backgroundColor: palette.baseElevated },
  lineText: { flex: 1, color: palette.creamMuted, fontFamily: fonts.mono, fontSize: 13 },
  right: { textAlign: 'right' },
  vs: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 11, width: 24, textAlign: 'center' },
  winner: { color: palette.cream },
  loser: { color: palette.chromeDim, textDecorationLine: 'line-through' },
  muted: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 12, textAlign: 'center' },
  error: { color: palette.wrong, textAlign: 'center' },
});
