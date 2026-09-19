/**
 * Privacy policy and terms of use, rendered in-app at /privacy and /terms
 * and mirrored to docs/legal. Plain-English documents for a free,
 * non-commercial project run by a private individual in the United States.
 * Remaining bracketed placeholders are filled in at deploy time. Not legal advice.
 */
export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  title: string;
  effectiveDate: string;
  intro: string;
  sections: LegalSection[];
}

export const OPERATOR = {
  name: 'Max Weidemann',
  email: 'max@intolerator.com',
  homepage: 'https://intolerator.com',
  appDomain: 'https://quiztape.com',
} as const;

export const PRIVACY_POLICY: LegalDocument = {
  title: 'Privacy Policy',
  effectiveDate: '2026-09-19',
  intro:
    'Quiztape turns your Last.fm listening history into a music quiz. It is a non-commercial project run by a private individual, not a company. This policy explains what data Quiztape handles, why, where it lives, and how you can get rid of it. Connecting your Last.fm account means you have read this policy and agree to it.',
  sections: [
    {
      heading: 'Who is responsible',
      paragraphs: [
        `Quiztape is operated by ${OPERATOR.name}, a private individual (homepage: ${OPERATOR.homepage}). Contact for anything in this policy: ${OPERATOR.email}. A postal address is available on request by email.`,
      ],
    },
    {
      heading: 'What data Quiztape processes',
      paragraphs: [
        'Last.fm account data: your Last.fm username, profile URL, the real name and country you made public on Last.fm, your registration date and total play count. Quiztape uses these to identify your account and show your name in the app.',
        'Listening history: every scrobble Last.fm reports for your account (artist, track, album, timestamp, and whether you marked it as loved). Quiztape imports your full history once and then fetches only new plays when you open the app or press refresh. All quiz statistics are computed from this copy.',
        'Last.fm session key: the key Last.fm issues when you approve Quiztape. It is stored encrypted and used only to read data. Quiztape never scrobbles, loves, tags or changes anything on your Last.fm account.',
        'Quiz data: the rounds you play, the questions asked, your answers, scores, streaks and your settings (difficulty, timer, optional question categories).',
        'Technical data: a login token for your device (stored as a hash on the server and in secure storage or browser storage on your device), the platform you use (web, iOS, Android), and short-lived server logs that include your IP address for error diagnosis and abuse prevention.',
        'Optional AI grading: if enabled in settings, the text of a quiz question and the answer you typed may be sent to Anthropic (Claude API) to judge an ambiguous free-text answer or to rephrase a question. Your listening history, username and account data are never sent.',
      ],
    },
    {
      heading: 'Why',
      paragraphs: [
        'Quiztape processes this data for one reason: to provide the service you asked for by connecting your account. That means importing your history, generating questions from it, grading your answers and remembering your results. The optional AI grading only runs if you switch it on in settings, and you can switch it off again at any time.',
        'Quiztape does not show advertising, does not use analytics or tracking services, does not build profiles for anyone else and does not sell, rent or share your data for money or for marketing.',
      ],
    },
    {
      heading: 'Where the data is stored and who else touches it',
      paragraphs: [
        'Database: hosted Postgres at Supabase, region [EU or US region of your project]. Application server: [hosting provider and region]. Web app: [static hosting provider]. These providers process data on Quiztape’s behalf under their standard data processing terms.',
        'Last.fm (Last.fm Ltd) is the source of your account data and listening history; Quiztape reads it through the official Last.fm API under Last.fm’s terms.',
        'MusicBrainz and Wikidata provide facts about artists and albums (release years, band members, track listings). Quiztape looks these up by artist name and public identifiers only; none of your personal data is sent to them.',
        'Anthropic receives question text and typed answers only if you enable AI grading, as described above.',
      ],
    },
    {
      heading: 'How long data is kept',
      paragraphs: [
        'Your account data, listening history and quiz data are kept for as long as you have a Quiztape account. When you delete your account in the app, everything Quiztape holds about you is deleted immediately, including your listening history, session key, rounds and answers. Cached facts about artists and albums are not personal data and are kept.',
        'Server logs are deleted after at most 30 days.',
        'You can also revoke Quiztape’s access in your Last.fm settings under Applications. That invalidates the session key; your Quiztape account and its data remain until you delete them.',
      ],
    },
    {
      heading: 'Your choices',
      paragraphs: [
        'You can delete your account and every piece of data Quiztape holds about you directly in the app, at any time, no questions asked. If you would like a copy of your data or want something corrected, email the address above and it will be handled within 30 days.',
        'You can also cut Quiztape off at the source by removing it under Applications in your Last.fm settings.',
      ],
    },
    {
      heading: 'Cookies and local storage',
      paragraphs: [
        'Quiztape sets no cookies. The web app keeps your login token in the browser’s local storage; the native apps keep it in the device’s secure storage. Nothing else is stored on your device.',
      ],
    },
    {
      heading: 'Children',
      paragraphs: ['Quiztape is not directed at children under 16 and does not knowingly process their data. Last.fm accounts require a minimum age under Last.fm’s own terms.'],
    },
    {
      heading: 'Changes to this policy',
      paragraphs: ['If this policy changes in a way that matters to you, the app will say so the next time you open it and the effective date above will move. The current version is always at ' + OPERATOR.appDomain + '/privacy.'],
    },
  ],
};

export const TERMS_OF_USE: LegalDocument = {
  title: 'Terms of Use',
  effectiveDate: '2026-09-19',
  intro:
    'Quiztape is a free, non-commercial music quiz made by one person for fun. These terms keep expectations honest on both sides. By connecting your Last.fm account you agree to them; if you do not, please do not use Quiztape.',
  sections: [
    {
      heading: 'The service',
      paragraphs: [
        `Quiztape (${OPERATOR.appDomain}) is provided by ${OPERATOR.name} (${OPERATOR.homepage}) as a hobby project. It builds quiz rounds from your own Last.fm listening history and from public music facts. It is offered free of charge and without any commercial purpose.`,
        'A Last.fm account is required. Quiztape reads your listening data through the official Last.fm API only with your approval and never writes to your Last.fm account.',
      ],
    },
    {
      heading: 'What you agree to',
      paragraphs: [
        'Use Quiztape only with a Last.fm account you are entitled to use. Do not attempt to access other people’s data, to interfere with the service, to circumvent rate limits, or to scrape, copy or resell data obtained through Quiztape.',
        'You are responsible for keeping your device and login secure. Anyone with access to your logged-in device can play as you.',
      ],
    },
    {
      heading: 'Third-party data and attribution',
      paragraphs: [
        'Listening data comes from Last.fm and remains subject to Last.fm’s terms. Quiztape is powered by AudioScrobbler but is not affiliated with or endorsed by Last.fm.',
        'Music facts come from MusicBrainz and Wikidata, whose data is released under CC0. Cover art, where shown, is served from the Cover Art Archive. Quiztape is not affiliated with these projects either.',
      ],
    },
    {
      heading: 'Availability and changes',
      paragraphs: [
        'Quiztape may change, break or shut down at any time without notice. Features can be added or removed, and your history may need to be re-imported after changes. There is no service level commitment of any kind.',
      ],
    },
    {
      heading: 'No warranty',
      paragraphs: [
        'Quiztape is provided “as is” and “as available”, without warranties of any kind, express or implied, including fitness for a particular purpose and accuracy. Quiz questions are generated automatically from third-party data and may be wrong.',
      ],
    },
    {
      heading: 'Limitation of liability',
      paragraphs: [
        'To the maximum extent permitted by applicable law, the operator is not liable for any indirect, incidental, special or consequential damages arising from your use of Quiztape, and total liability for any claim is limited to the amount you paid for the service, which is nothing. Some states do not allow certain exclusions or limitations, so parts of this section may not apply to you.',
      ],
    },
    {
      heading: 'Ending things',
      paragraphs: [
        'You can stop using Quiztape at any time and delete your account and data in the app. The operator may suspend or delete accounts that break these terms or that stay inactive for a long time; in the latter case reasonable notice will be given where possible.',
      ],
    },
    {
      heading: 'Governing law',
      paragraphs: ['These terms are governed by the laws of the State of [your US state] and applicable United States federal law, without regard to conflict-of-law rules.'],
    },
    {
      heading: 'Contact',
      paragraphs: [`Questions about these terms: ${OPERATOR.email}.`],
    },
  ],
};
