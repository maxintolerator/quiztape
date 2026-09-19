import type { SyncSummary } from '@quiztape/shared';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, palette, radius, spacing } from '@/theme/tokens';

/** Tape spooling from left to right as pages come in, with a big percentage. */
export function SyncProgress({ sync, compact = false }: { sync: SyncSummary; compact?: boolean }) {
  const percent = sync.percent ?? 0;
  const indeterminate = sync.phase === 'pending' || (sync.phase === 'backfilling' && sync.pagesTotal === null);
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
      {!compact ? <Text style={styles.percent}>{indeterminate ? '…' : `${percent}%`}</Text> : null}
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${indeterminate ? 4 : Math.max(2, percent)}%` }]} />
      </View>
      <Text style={styles.detail}>
        {sync.phase === 'pending'
          ? 'Contacting Last.fm…'
          : sync.phase === 'backfilling'
            ? `Page ${sync.pagesDone ?? 0}${sync.pagesTotal ? ` of ${sync.pagesTotal}` : ''} · ${sync.scrobbleCount.toLocaleString()} scrobbles so far`
            : `${sync.scrobbleCount.toLocaleString()} scrobbles on tape`}
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
