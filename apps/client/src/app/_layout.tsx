import '@/global.css';

import { DarkTheme, Stack, ThemeProvider, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useSession } from '@/store/session';
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

/** Routes reachable without a session. Everything else requires Last.fm login. */
const PUBLIC_ROUTES = new Set(['/', '/auth/callback', '/_sitemap']);

function useAuthGate() {
  const status = useSession((s) => s.status);
  const hydrate = useSession((s) => s.hydrate);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status === 'loading') return;
    const isPublic = PUBLIC_ROUTES.has(pathname);
    if (status === 'anonymous' && !isPublic) router.replace('/');
    if (status === 'authenticated' && pathname === '/') router.replace('/home');
  }, [status, pathname, router]);
}

export default function RootLayout() {
  useAuthGate();
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
