/** Mirror the in-app legal documents to docs/legal as Markdown. Run: npm run legal:render */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type LegalDocument, PRIVACY_POLICY, TERMS_OF_USE } from '../src/legal';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'legal');
mkdirSync(outDir, { recursive: true });

function render(doc: LegalDocument): string {
  const body = doc.sections.map((s) => `## ${s.heading}\n\n${s.paragraphs.join('\n\n')}`).join('\n\n');
  return `# ${doc.title}\n\n_Effective ${doc.effectiveDate}. Source of truth: \`packages/shared/src/legal.ts\`, served in-app at /${doc.title.toLowerCase().includes('privacy') ? 'privacy' : 'terms'}. Regenerate with \`npm run legal:render\`._\n\n${doc.intro}\n\n${body}\n`;
}

writeFileSync(resolve(outDir, 'PRIVACY.md'), render(PRIVACY_POLICY));
writeFileSync(resolve(outDir, 'TERMS.md'), render(TERMS_OF_USE));
console.log('wrote docs/legal/PRIVACY.md and docs/legal/TERMS.md');
