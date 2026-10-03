import type { ImportProgress } from '@quiztape/shared';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, palette, radius, spacing } from '@/theme/tokens';

/** Tape spooling from left to right as pages come in, with a big percentage. `progress` is null until Last.fm answers. */
export function SyncProgress({ progress }: { progress: ImportProgress | null }) {
  const total = progress?.pagesTotal ?? null;
  const indeterminate = !progress || total === null;
  const percent = indeterminate ? 0 : total === 0 ? 100 : Math.min(99, Math.round((progress.pagesDone / total) * 100));
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
      <Text style={styles.percent}>{indeterminate ? '…' : `${percent}%`}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${indeterminate ? 4 : Math.max(2, percent)}%` }]} />
      </View>
      <Text style={styles.detail}>
        {indeterminate ? 'Contacting Last.fm…' : `Page ${progress.pagesDone} of ${total} · ${progress.scrobbles.toLocaleString()} scrobbles so far`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: spacing.sm, alignItems: 'center' },
  percent: { color: palette.cream, fontFamily: fonts.display, fontSize: 72, lineHeight: 76, letterSpacing: 2 },
  track: { width: '100%', height: 10, borderRadius: radius.pill, backgroundColor: palette.baseSunken, overflow: 'hidden', borderWidth: 1, borderColor: palette.chromeDim },
  fill: { height: '100%', backgroundColor: palette.magenta, borderRadius: radius.pill },
  detail: { color: palette.creamMuted, fontFamily: fonts.mono, fontSize: 12, textAlign: 'center' },
});
