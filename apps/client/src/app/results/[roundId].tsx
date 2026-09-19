import type { RoundResultsDto } from '@quiztape/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SupportLink } from '@/components/support-link';
import { TapeButton } from '@/components/tape-button';
import { api } from '@/lib/api';
import { useSession } from '@/store/session';
import { fonts, layout, palette, radius, spacing } from '@/theme/tokens';

/** Score card plus the per-question recap, laid out like a tracklist. The shareable image lands in step 5. */
export default function ResultsScreen() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const token = useSession((s) => s.token);
  const router = useRouter();
  const [results, setResults] = useState<RoundResultsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !roundId) return;
    api<RoundResultsDto>(`/v1/rounds/${roundId}/results`, { token })
      .then(setResults)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load results'));
  }, [token, roundId]);

  const round = results?.round;
  const accuracy = round && round.questionCount > 0 ? Math.round((round.correctCount / round.questionCount) * 100) : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {round && results ? (
          <>
            <View style={styles.card}>
              <Text style={styles.kicker}>{round.mode === 'side_a' ? 'SIDE A · YOUR STATS' : 'SIDE B · TRIVIA'}</Text>
              <Text style={styles.title}>{results.user.lastfmUsername}</Text>
              <Text style={styles.score}>{round.score.toLocaleString()}</Text>
              <Text style={styles.scoreSub}>
                of {round.maxScore.toLocaleString()} · {round.correctCount}/{round.questionCount} correct · {accuracy}% · best streak {round.bestStreak}
              </Text>
              <Text style={styles.footnote}>Difficulty: {round.difficulty.replace('_', ' ')} · Listening data from Last.fm</Text>
            </View>

            <Text style={styles.sectionTitle}>TRACKLIST</Text>
            <View style={styles.list}>
              {results.items.map((item) => (
                <View key={item.position} style={styles.row}>
                  <Text style={[styles.rowIndex, { color: item.correct ? palette.correct : palette.wrong }]}>{String(item.position + 1).padStart(2, '0')}</Text>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowPrompt}>{item.prompt}</Text>
                    <Text style={styles.rowAnswer}>{item.correctDisplay}</Text>
                    {!item.correct && item.yourAnswerDisplay ? <Text style={styles.rowYours}>you: {item.yourAnswerDisplay}</Text> : null}
                  </View>
                  <Text style={styles.rowPoints}>+{item.pointsAwarded}</Text>
                </View>
              ))}
            </View>

            <TapeButton label="PLAY ANOTHER" onPress={() => router.replace('/home')} />
            <SupportLink />
          </>
        ) : !error ? (
          <Text style={styles.muted}>Rewinding…</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.base },
  content: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg },
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: palette.cream, gap: spacing.xs },
  kicker: { color: palette.magenta, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2 },
  title: { color: palette.base, fontFamily: fonts.marker, fontSize: 22 },
  score: { color: palette.base, fontFamily: fonts.display, fontSize: 64, lineHeight: 68 },
  scoreSub: { color: palette.chromeDim, fontFamily: fonts.mono, fontSize: 12 },
  footnote: { color: palette.chromeDim, fontSize: 11, marginTop: spacing.sm },
  sectionTitle: { color: palette.creamMuted, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 2 },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.baseElevated, alignItems: 'flex-start' },
  rowIndex: { fontFamily: fonts.mono, fontSize: 14, width: 24 },
  rowBody: { flex: 1, gap: 2 },
  rowPrompt: { color: palette.creamMuted, fontSize: 13 },
  rowAnswer: { color: palette.cream, fontSize: 15 },
  rowYours: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 12 },
  rowPoints: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 13 },
  muted: { color: palette.chrome, textAlign: 'center', fontFamily: fonts.mono },
  error: { color: palette.wrong, textAlign: 'center' },
});
