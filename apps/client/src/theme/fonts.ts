import { Anton_400Regular } from '@expo-google-fonts/anton';
import { PermanentMarker_400Regular } from '@expo-google-fonts/permanent-marker';
import { SpaceMono_400Regular } from '@expo-google-fonts/space-mono';
import { useFonts } from 'expo-font';

/** Same three files on web, iOS and Android. Names match `fonts` in tokens.ts. */
export function useBrandFonts(): boolean {
  const [loaded, error] = useFonts({ Anton_400Regular, SpaceMono_400Regular, PermanentMarker_400Regular });
  return loaded || error !== null;
}
