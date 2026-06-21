import { MarkdownTextSplitter } from '@langchain/textsplitters';

export interface ChunkResult {
  text: string;
  section: string;
  title: string;
  date: string | null;
  tags: string[];
}

interface ChunkMetadata {
  title?: string;
  date?: string | null;
  tags?: string[];
}

interface ChunkOptions {
  minChunkSize?: number;
  maxChunkSize?: number;
}

export async function chunkContent(
  content: string,
  metadata: ChunkMetadata = {},
  options: ChunkOptions = {},
): Promise<ChunkResult[]> {
  const { minChunkSize = 100, maxChunkSize = 1500 } = options;
  const splitter = new MarkdownTextSplitter({
    chunkSize: maxChunkSize,
    chunkOverlap: 80,
  });
  const docs = await splitter.createDocuments([content]);
  const chunks: ChunkResult[] = [];
  let lastHeading = '';
  for (const doc of docs) {
    const text = doc.pageContent.trim();
    if (!text) continue;
    // Extract heading from first line if present
    const headingMatch = text.match(/^#{1,3}\s+(.+)/);
    const currentHeading = headingMatch ? headingMatch[1].trim() : lastHeading;
    if (headingMatch) lastHeading = currentHeading;
    // Remove the heading line from chunk text (it's metadata now)
    const cleanText = headingMatch ? text.replace(/^#{1,3}\s+.+\n?/, '').trim() : text;
    if (cleanText.length < minChunkSize && chunks.length > 0) {
      // Merge small trailing chunks into previous one
      chunks[chunks.length - 1].text += '\n\n' + cleanText;
      continue;
    }
    chunks.push({
      text: cleanText,
      section: currentHeading,
      title: metadata.title || '',
      date: metadata.date ?? null,
      tags: metadata.tags || [],
    });
  }
  return chunks;
}
