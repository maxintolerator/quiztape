import '@/global.css';

import { DarkTheme, Stack, ThemeProvider, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useLibrary } from '@/store/library';
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

/** Routes reachable without a session. Everything else requires signing in with a Last.fm username. */
const PUBLIC_ROUTES = new Set(['/', '/privacy', '/terms', '/_sitemap']);

/**
 * Three states, three doors: anonymous -> connect; authenticated but the
 * library is not on this device yet -> /sync; ready -> /home and the rest of the app.
 */
function useAuthGate() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const apiKey = useSession((s) => s.lastfmApiKey);
  const hydrate = useSession((s) => s.hydrate);
  const openLibrary = useLibrary((s) => s.open);
  const ready = useLibrary((s) => s.phase === 'ready' && (s.snapshot?.scrobbleCount ?? 0) > 0);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // The library belongs to the signed-in player; reading it needs the Last.fm key the API hands out.
  useEffect(() => {
    if (status === 'authenticated' && user && apiKey) void openLibrary(user.lastfmUsername, apiKey);
  }, [status, user, apiKey, openLibrary]);

  useEffect(() => {
    if (status === 'loading') return;
    const isPublic = PUBLIC_ROUTES.has(pathname);
    if (status === 'anonymous') {
      if (!isPublic) router.replace('/');
      return;
    }
    // Authenticated. Everything short of a playable library (still importing, blocked, empty, API unreachable) is the sync screen's job.
    if (!ready && pathname !== '/sync' && (pathname === '/' || !isPublic)) router.replace('/sync');
    if (ready && (pathname === '/' || pathname === '/sync')) router.replace('/home');
  }, [status, ready, pathname, router]);
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
