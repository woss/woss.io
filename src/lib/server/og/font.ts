import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const regularPath = join(process.cwd(), 'src/lib/server/og/fonts/IBMPlexSans-Regular.ttf');
const boldPath = join(process.cwd(), 'src/lib/server/og/fonts/IBMPlexSans-Bold.ttf');

export const ibmPlexSansRegular = readFileSync(regularPath);
export const ibmPlexSansBold = readFileSync(boldPath);
