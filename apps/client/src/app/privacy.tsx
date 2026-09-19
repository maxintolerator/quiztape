import { PRIVACY_POLICY } from '@quiztape/shared';

import { LegalDocumentScreen } from '@/components/legal-document';

export default function PrivacyScreen() {
  return <LegalDocumentScreen document={PRIVACY_POLICY} />;
}
