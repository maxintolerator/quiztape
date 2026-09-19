import { type AnswerSubmission, type QuestionDto, UNIT_DURATION, UNIT_RANK } from '@quiztape/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { TapeButton } from '@/components/tape-button';
import { fonts, palette, radius, spacing } from '@/theme/tokens';

interface AnswerInputProps {
  question: QuestionDto;
  disabled: boolean;
  onSubmit: (submission: AnswerSubmission) => void;
}

/** Renders the right control for the question's answer format and emits a submission. */
export function AnswerInput({ question, disabled, onSubmit }: AnswerInputProps) {
  if (question.answerFormat === 'multiple_choice') return <ChoiceInput question={question} disabled={disabled} onSubmit={onSubmit} />;
  if (question.answerFormat === 'order') return <OrderInput question={question} disabled={disabled} onSubmit={onSubmit} />;
  return <TypedInput question={question} disabled={disabled} onSubmit={onSubmit} />;
}

function ChoiceInput({ question, disabled, onSubmit }: AnswerInputProps) {
  return (
    <View style={styles.options} accessibilityRole="radiogroup">
      {(question.options ?? []).map((option) => (
        <Pressable
          key={option.id}
          accessibilityRole="radio"
          disabled={disabled}
          onPress={() => onSubmit({ kind: 'option', optionId: option.id })}
          style={({ pressed }) => [styles.option, pressed && styles.optionPressed, disabled && styles.disabled]}>
          <Text style={styles.optionLabel}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Tap items in order; they move from the pool to the numbered sequence. */
function OrderInput({ question, disabled, onSubmit }: AnswerInputProps) {
  const options = question.options ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const remaining = options.filter((o) => !picked.includes(o.id));
  const complete = picked.length === options.length && options.length > 0;
  return (
    <View style={styles.free}>
      <View style={styles.sequence}>
        {picked.length === 0 ? <Text style={styles.sequenceHint}>Tap the albums in order, oldest first.</Text> : null}
        {picked.map((id, index) => {
          const option = options.find((o) => o.id === id);
          return (
            <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Remove ${option?.label} from position ${index + 1}`} disabled={disabled} onPress={() => setPicked(picked.filter((p) => p !== id))} style={styles.sequenceItem}>
              <Text style={styles.sequenceIndex}>{index + 1}</Text>
              <Text style={styles.optionLabel}>{option?.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.options}>
        {remaining.map((option) => (
          <Pressable key={option.id} accessibilityRole="button" disabled={disabled} onPress={() => setPicked([...picked, option.id])} style={({ pressed }) => [styles.option, pressed && styles.optionPressed, disabled && styles.disabled]}>
            <Text style={styles.optionLabel}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      <TapeButton label="LOCK IN" tone={question.side} onPress={() => onSubmit({ kind: 'order', optionIds: picked })} disabled={disabled || !complete} />
      <View style={styles.row}>
        <Pressable accessibilityRole="button" disabled={disabled || picked.length === 0} onPress={() => setPicked([])} style={styles.skip}>
          <Text style={styles.skipLabel}>Reset</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onSubmit({ kind: 'skip' })} style={styles.skip}>
          <Text style={styles.skipLabel}>Skip</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Free text, a number, or a duration typed as m:ss. */
function TypedInput({ question, disabled, onSubmit }: AnswerInputProps) {
  const [text, setText] = useState('');
  const numeric = question.answerFormat === 'numeric';
  const duration = numeric && question.unit === UNIT_DURATION;

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (duration) {
      const seconds = parseDuration(trimmed);
      if (seconds === null) return;
      onSubmit({ kind: 'numeric', value: seconds });
      return;
    }
    if (numeric) {
      const value = Number(trimmed.replace(/^#/, '').replace(',', '.'));
      if (!Number.isFinite(value)) return;
      onSubmit({ kind: 'numeric', value });
      return;
    }
    onSubmit({ kind: 'text', text: trimmed });
  };

  return (
    <View style={styles.free}>
      <TextInput
        accessibilityLabel={duration ? 'Your answer as minutes and seconds' : numeric ? 'Your answer as a number' : 'Your answer'}
        value={text}
        onChangeText={setText}
        editable={!disabled}
        autoFocus
        autoCapitalize={numeric ? 'none' : 'words'}
        autoCorrect={false}
        keyboardType={duration ? 'numbers-and-punctuation' : numeric ? 'number-pad' : 'default'}
        inputMode={duration ? 'text' : numeric ? 'numeric' : 'text'}
        placeholder={duration ? 'm:ss' : numeric ? (question.unit === UNIT_RANK ? '#' : '0') : 'Type your answer'}
        placeholderTextColor={palette.chrome}
        returnKeyType="send"
        onSubmitEditing={submit}
        style={styles.input}
      />
      <TapeButton label="LOCK IN" tone={question.side} onPress={submit} disabled={disabled || !text.trim()} />
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onSubmit({ kind: 'skip' })} style={styles.skip}>
        <Text style={styles.skipLabel}>Skip</Text>
      </Pressable>
    </View>
  );
}

/** "4:32" -> 272, "272" -> 272, "4.32" is treated as 4:32. */
export function parseDuration(input: string): number | null {
  const match = input.match(/^(\d{1,3})\s*[:.]\s*(\d{1,2})$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const seconds = Number(input);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null;
}

const styles = StyleSheet.create({
  options: { gap: spacing.sm, width: '100%' },
  option: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.chromeDim, backgroundColor: palette.baseElevated },
  optionPressed: { borderColor: palette.cream },
  optionLabel: { color: palette.cream, fontSize: 16, fontFamily: fonts.mono },
  disabled: { opacity: 0.5 },
  free: { gap: spacing.sm, width: '100%' },
  sequence: { gap: spacing.xs, minHeight: 44, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: palette.chromeDim },
  sequenceHint: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 12, textAlign: 'center' },
  sequenceItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  sequenceIndex: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 14, width: 20 },
  row: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  input: {
    borderWidth: 1,
    borderColor: palette.chromeDim,
    borderRadius: radius.md,
    padding: spacing.md,
    color: palette.cream,
    fontFamily: fonts.mono,
    fontSize: 18,
    backgroundColor: palette.baseElevated,
  },
  skip: { alignSelf: 'center', padding: spacing.sm },
  skipLabel: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1 },
});
