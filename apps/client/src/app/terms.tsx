import { TERMS_OF_USE } from '@quiztape/shared';

import { LegalDocumentScreen } from '@/components/legal-document';

export default function TermsScreen() {
  return <LegalDocumentScreen document={TERMS_OF_USE} />;
}
