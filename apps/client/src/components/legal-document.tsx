import type { LegalDocument } from '@quiztape/shared';
import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts, layout, palette, spacing } from '@/theme/tokens';

/** Renders a legal document as a readable page on all three platforms. */
export function LegalDocumentScreen({ document }: { document: LegalDocument }) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/" style={styles.back}>
          ← Quiztape
        </Link>
        <Text style={styles.title} accessibilityRole="header">
          {document.title}
        </Text>
        <Text style={styles.meta}>Effective {document.effectiveDate}</Text>
        <Text style={styles.paragraph}>{document.intro}</Text>
        {document.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.heading} accessibilityRole="header">
              {section.heading}
            </Text>
            {section.paragraphs.map((paragraph, index) => (
              <Text key={index} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}
          </View>
        ))}
        <View style={styles.footer}>
          <Link href="/privacy" style={styles.link}>
            Privacy Policy
          </Link>
          <Link href="/terms" style={styles.link}>
            Terms of Use
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.base },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  back: { color: palette.cyan, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1 },
  title: { color: palette.cream, fontFamily: fonts.display, fontSize: 40, letterSpacing: 1 },
  meta: { color: palette.chrome, fontFamily: fonts.mono, fontSize: 12 },
  section: { gap: spacing.sm, marginTop: spacing.sm },
  heading: { color: palette.cream, fontFamily: fonts.display, fontSize: 22, letterSpacing: 0.5 },
  paragraph: { color: palette.creamMuted, fontSize: 15, lineHeight: 23 },
  footer: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.lg, maxWidth: layout.maxContentWidth },
  link: { color: palette.cyan, textDecorationLine: 'underline', fontFamily: fonts.mono, fontSize: 12 },
});
