import '@/global.css';

import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { palette } from '@/theme/tokens';

const quiztapeTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: palette.magenta,
    background: palette.base,
    card: palette.baseElevated,
    text: palette.cream,
    border: palette.chromeDim,
    notification: palette.cyan,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={quiztapeTheme}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.base },
        }}
      />
    </ThemeProvider>
  );
}
