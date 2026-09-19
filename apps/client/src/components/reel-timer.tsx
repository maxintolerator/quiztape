import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { fonts, palette, radius } from '@/theme/tokens';

interface ReelTimerProps {
  /** Remaining time in ms; the reels stop when it reaches zero. */
  remainingMs: number;
  totalMs: number;
  running: boolean;
  tone: 'a' | 'b';
}

/** Two tape reels that spin while the clock runs, plus a progress strip. Honors reduced motion. */
export function ReelTimer({ remainingMs, totalMs, running, tone }: ReelTimerProps) {
  const spin = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const accent = tone === 'a' ? palette.magenta : palette.cyan;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => mounted && setReduceMotion(enabled))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!running || reduceMotion) {
      spin.stopAnimation();
      return;
    }
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [running, reduceMotion, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const fraction = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <View style={styles.wrap} accessibilityRole="timer" accessibilityLabel={`${seconds} seconds left`}>
      <View style={styles.reels}>
        <Reel rotate={rotate} accent={accent} fill={1 - fraction} />
        <Text style={[styles.clock, seconds <= 5 && { color: palette.wrong }]}>{String(seconds).padStart(2, '0')}</Text>
        <Reel rotate={rotate} accent={accent} fill={fraction} />
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: accent }]} />
      </View>
    </View>
  );
}

function Reel({ rotate, accent, fill }: { rotate: Animated.AnimatedInterpolation<string>; accent: string; fill: number }) {
  const size = 44;
  const tape = Math.round(6 + fill * 10);
  return (
    <View style={[styles.reelOuter, { width: size, height: size, borderColor: palette.chromeDim, borderWidth: tape }]}>
      <Animated.View style={[styles.reelInner, { borderColor: accent, transform: [{ rotate }] }]}>
        {[0, 60, 120].map((deg) => (
          <View key={deg} style={[styles.spoke, { transform: [{ rotate: `${deg}deg` }] }]} />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 8 },
  reels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  clock: { fontFamily: fonts.mono, fontSize: 22, color: palette.cream, minWidth: 40, textAlign: 'center' },
  reelOuter: { borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.baseSunken },
  reelInner: { width: 18, height: 18, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  spoke: { position: 'absolute', width: 14, height: 2, backgroundColor: palette.chrome, borderRadius: 1 },
  track: { height: 4, borderRadius: radius.pill, backgroundColor: palette.baseSunken, overflow: 'hidden' },
  fill: { height: '100%' },
});
