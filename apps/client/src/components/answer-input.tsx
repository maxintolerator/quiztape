import type { AnswerSubmission, QuestionDto } from '@quiztape/shared';
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
  const [text, setText] = useState('');
  const tone = question.side;

  if (question.answerFormat === 'multiple_choice') {
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

  const numeric = question.answerFormat === 'numeric';
  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (numeric) {
      const value = Number(trimmed.replace(/^#/, '').replace(',', '.'));
      if (!Number.isFinite(value)) return;
      onSubmit({ kind: 'numeric', value });
    } else {
      onSubmit({ kind: 'text', text: trimmed });
    }
  };

  return (
    <View style={styles.free}>
      <TextInput
        accessibilityLabel={numeric ? 'Your answer as a number' : 'Your answer'}
        value={text}
        onChangeText={setText}
        editable={!disabled}
        autoFocus
        autoCapitalize={numeric ? 'none' : 'words'}
        autoCorrect={false}
        keyboardType={numeric ? 'number-pad' : 'default'}
        inputMode={numeric ? 'numeric' : 'text'}
        placeholder={numeric ? (question.unit === 'rank' ? '#' : '0') : 'Type your answer'}
        placeholderTextColor={palette.chrome}
        returnKeyType="send"
        onSubmitEditing={submit}
        style={styles.input}
      />
      <TapeButton label="LOCK IN" tone={tone} onPress={submit} disabled={disabled || !text.trim()} />
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onSubmit({ kind: 'skip' })} style={styles.skip}>
        <Text style={styles.skipLabel}>Skip</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  options: { gap: spacing.sm, width: '100%' },
  option: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.chromeDim, backgroundColor: palette.baseElevated },
  optionPressed: { borderColor: palette.cream },
  optionLabel: { color: palette.cream, fontSize: 16, fontFamily: fonts.mono },
  disabled: { opacity: 0.5 },
  free: { gap: spacing.sm, width: '100%' },
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
