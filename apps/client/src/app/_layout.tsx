import '@/global.css';

import { isLibraryReady } from '@quiztape/shared';
import { DarkTheme, Stack, ThemeProvider, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useSession } from '@/store/session';
import { useBrandFonts } from '@/theme/fonts';
import { palette } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

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

/**
 * Three states, three doors: anonymous -> connect; authenticated but the
 * library is still syncing -> /sync; ready -> /home and the rest of the app.
 */
function useAuthGate() {
  const status = useSession((s) => s.status);
  const sync = useSession((s) => s.sync);
  const hydrate = useSession((s) => s.hydrate);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status === 'loading') return;
    const isPublic = PUBLIC_ROUTES.has(pathname);
    if (status === 'anonymous') {
      if (!isPublic) router.replace('/');
      return;
    }
    // Authenticated. Unknown sync state (API unreachable) leaves the current screen alone.
    if (sync === null) {
      if (pathname === '/') router.replace('/sync');
      return;
    }
    const ready = isLibraryReady(sync);
    if (!ready && pathname !== '/sync' && pathname !== '/auth/callback') router.replace('/sync');
    if (ready && (pathname === '/' || pathname === '/sync')) router.replace('/home');
  }, [status, sync, pathname, router]);
}

export default function RootLayout() {
  useAuthGate();
  const fontsReady = useBrandFonts();
  const status = useSession((s) => s.status);

  useEffect(() => {
    if (fontsReady && status !== 'loading') void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsReady, status]);

  return (
    <ThemeProvider value={quiztapeTheme}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.base },
          animation: 'fade',
        }}
      />
    </ThemeProvider>
  );
}
