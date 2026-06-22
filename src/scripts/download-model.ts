import { pipeline } from '@huggingface/transformers';
import { initLogger, CAT, createLogger } from '../lib/server/logger.ts';

await initLogger((process.env.LOG_LEVEL as 'trace' | 'debug' | 'info' | 'warning' | 'error') || 'info');
const log = createLogger(CAT.llm);

const extractor = await pipeline('feature-extraction', 'Xenova/bge-large-en-v1.5');
log.info`Model downloaded and loaded`;
const result = await extractor('test', { pooling: 'mean', normalize: true });
log.info`Test embedding shape: ${result.data.length}`;
