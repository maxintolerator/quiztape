import type { SyncSummary } from '@quiztape/shared';
import { StyleSheet, Text, View } from 'react-native';

import { palette, radius, spacing } from '@/theme/tokens';

/** First-sync state: a tape spooling from left to right as pages come in. */
export function SyncProgress({ sync }: { sync: SyncSummary }) {
  const percent = sync.percent ?? 0;
  const label =
    sync.phase === 'pending'
      ? 'Waiting for the first page…'
      : sync.phase === 'backfilling'
        ? `Rewinding your history: page ${sync.pagesDone ?? 0} of ${sync.pagesTotal ?? '?'}`
        : sync.phase === 'privacy_blocked'
          ? 'Last.fm hides your recent listening. Turn off "Hide recent listening information" in Last.fm privacy settings, then refresh.'
          : sync.phase === 'error'
            ? `Sync hit a snag: ${sync.lastError ?? 'unknown error'}. It will retry.`
            : `${sync.scrobbleCount.toLocaleString()} scrobbles on tape`;

  return (
    <View style={styles.card} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
      <Text style={styles.kicker}>{sync.phase === 'complete' ? 'LIBRARY SYNCED' : 'FIRST SYNC'}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(2, percent)}%` }]} />
      </View>
      <Text style={styles.label}>{label}</Text>
      {sync.phase !== 'complete' && sync.scrobbleCount > 0 ? (
        <Text style={styles.count}>{sync.scrobbleCount.toLocaleString()} scrobbles so far</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: palette.baseElevated, borderWidth: 1, borderColor: palette.chromeDim },
  kicker: { color: palette.cyan, fontSize: 11, letterSpacing: 2 },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: palette.baseSunken, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: palette.magenta, borderRadius: radius.pill },
  label: { color: palette.cream, fontSize: 14, lineHeight: 20 },
  count: { color: palette.creamMuted, fontSize: 12 },
});
