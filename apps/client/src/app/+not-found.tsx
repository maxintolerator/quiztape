import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { palette, spacing } from '@/theme/tokens';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Nothing on this side' }} />
      <View style={styles.container}>
        <Text style={styles.title}>Blank tape.</Text>
        <Text style={styles.body}>That route does not exist.</Text>
        <Link href="/" style={styles.link}>
          Rewind to the start
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: palette.base,
  },
  title: { color: palette.cream, fontSize: 28, fontWeight: '700' },
  body: { color: palette.creamMuted },
  link: { color: palette.cyan, marginTop: spacing.md, textDecorationLine: 'underline' },
});
