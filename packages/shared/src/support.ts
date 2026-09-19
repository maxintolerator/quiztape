/** Ko-fi page name (the part after ko-fi.com/). Empty hides every support link. */
export const KOFI_USERNAME = '';
export const KOFI_URL: string | null = KOFI_USERNAME ? `https://ko-fi.com/${KOFI_USERNAME}` : null;
