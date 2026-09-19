import type { AnswerResultDto, AnswerSubmission, QuestionDto, RoundDto, RoundStateDto } from '@quiztape/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnswerInput } from '@/components/answer-input';
import { JCard } from '@/components/j-card';
import { ReelTimer } from '@/components/reel-timer';
import { TapeButton } from '@/components/tape-button';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/store/session';
import { fonts, layout, palette, radius, spacing } from '@/theme/tokens';

type Phase =
  | { kind: 'loading' }
  | { kind: 'question'; question: QuestionDto }
  | { kind: 'feedback'; result: AnswerResultDto }
  | { kind: 'error'; message: string };

const now = () => Date.now();

export default function PlayScreen() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const token = useSession((s) => s.token);
  const router = useRouter();
  const [round, setRound] = useState<RoundDto | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [remainingMs, setRemainingMs] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const startedAt = useRef<number>(0);
  const submitted = useRef(false);

  // Load or resume the round.
  useEffect(() => {
    if (!token || !roundId) return;
    let cancelled = false;
    api<RoundStateDto>(`/v1/rounds/${roundId}`, { token })
      .then((state) => {
        if (cancelled) return;
        setRound(state.round);
        if (state.round.status !== 'active' || !state.question) {
          router.replace({ pathname: '/results/[roundId]', params: { roundId } });
        } else {
          setPhase({ kind: 'question', question: state.question });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'Could not load the round' });
      });
    return () => {
      cancelled = true;
    };
  }, [token, roundId, router]);

  const submit = useCallback(
    async (question: QuestionDto, submission: AnswerSubmission) => {
      if (!token || submitted.current) return;
      submitted.current = true;
      setSubmitting(true);
      try {
        const responseMs = submission.kind === 'timeout' ? question.timeLimitSeconds * 1000 : Math.round(now() - startedAt.current);
        const result = await api<AnswerResultDto>(`/v1/rounds/${roundId}/answers`, {
          method: 'POST',
          token,
          body: { questionId: question.id, submission, responseMs },
        });
        setRound(result.round);
        setPhase({ kind: 'feedback', result });
      } catch (error) {
        submitted.current = false;
        setPhase({ kind: 'error', message: error instanceof ApiError ? error.message : 'Could not submit the answer' });
      } finally {
        setSubmitting(false);
      }
    },
    [token, roundId],
  );

  // Timer: starts with each question and submits a timeout when it runs out.
  useEffect(() => {
    if (phase.kind !== 'question') return;
    const question = phase.question;
    submitted.current = false;
    startedAt.current = now();
    const total = question.timeLimitSeconds * 1000;
    setRemainingMs(total);
    const interval = setInterval(() => {
      const left = total - (now() - startedAt.current);
      setRemainingMs(Math.max(0, left));
      if (left <= 0) {
        clearInterval(interval);
        void submit(question, { kind: 'timeout' });
      }
    }, 100);
    return () => clearInterval(interval);
  }, [phase, submit]);

  const next = () => {
    if (phase.kind !== 'feedback') return;
    if (phase.result.nextQuestion) setPhase({ kind: 'question', question: phase.result.nextQuestion });
    else router.replace({ pathname: '/results/[roundId]', params: { roundId: roundId! } });
  };

  const side = phase.kind === 'question' ? phase.question.side : 'a';
  const totalMs = phase.kind === 'question' ? phase.question.timeLimitSeconds * 1000 : 1;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.score}>
              {(round?.score ?? 0).toLocaleString()} <Text style={styles.scoreMax}>/ {(round?.maxScore ?? 0).toLocaleString()}</Text>
            </Text>
            {round && round.currentStreak >= 2 ? <Text style={styles.streak}>▶▶ {round.currentStreak} in a row</Text> : <View />}
          </View>

          {phase.kind === 'loading' ? <Text style={styles.muted}>Cueing up the tape…</Text> : null}

          {phase.kind === 'error' ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{phase.message}</Text>
              <TapeButton label="BACK HOME" tone="neutral" onPress={() => router.replace('/home')} />
            </View>
          ) : null}

          {phase.kind === 'question' ? (
            <>
              <ReelTimer remainingMs={remainingMs} totalMs={totalMs} running={!submitting} tone={side} />
              <JCard side={side} index={phase.question.position} total={phase.question.total} prompt={phase.question.prompt} hint={phase.question.hint} />
              <AnswerInput key={phase.question.id} question={phase.question} disabled={submitting} onSubmit={(s) => void submit(phase.question, s)} />
            </>
          ) : null}

          {phase.kind === 'feedback' ? (
            <View style={[styles.feedback, { borderColor: phase.result.correct ? palette.correct : palette.wrong }]}>
              <Text style={[styles.verdict, { color: phase.result.correct ? palette.correct : palette.wrong }]}>
                {phase.result.gradingMethod === 'timeout' ? 'TAPE RAN OUT' : phase.result.correct ? 'CORRECT' : 'NOT THIS TIME'}
              </Text>
              <Text style={styles.answerLabel}>THE ANSWER</Text>
              <Text style={styles.answer}>{phase.result.correctDisplay}</Text>
              {phase.result.yourAnswerDisplay && !phase.result.correct ? <Text style={styles.yours}>You said: {phase.result.yourAnswerDisplay}</Text> : null}
              {phase.result.explanation ? <Text style={styles.explanation}>{phase.result.explanation}</Text> : null}
              <Text style={styles.points}>+{phase.result.pointsAwarded} pts</Text>
              <TapeButton label={phase.result.nextQuestion ? 'NEXT' : 'SEE RESULTS'} tone={side} onPress={next} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.base },
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg, flexGrow: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  score: { color: palette.cream, fontFamily: fonts.display, fontSize: 28, letterSpacing: 1 },
  scoreMax: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 14 },
  streak: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1 },
  muted: { color: palette.chrome, textAlign: 'center', fontFamily: fonts.mono },
  errorBox: { gap: spacing.md, alignItems: 'center' },
  errorText: { color: palette.wrong, textAlign: 'center' },
  feedback: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 2, backgroundColor: palette.baseElevated },
  verdict: { fontFamily: fonts.display, fontSize: 32, letterSpacing: 2 },
  answerLabel: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2 },
  answer: { color: palette.cream, fontSize: 20, fontWeight: '700' },
  yours: { color: palette.creamMuted, fontFamily: fonts.mono, fontSize: 13 },
  explanation: { color: palette.creamMuted, fontSize: 13, lineHeight: 18 },
  points: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 16, marginTop: spacing.xs },
});
