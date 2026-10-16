import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, normalize, relative } from 'node:path';

export class ArtifactStore {
  constructor(private readonly root: string, private readonly maxBytes = 1024 * 1024) {}

  async put(relativePath: string, content: string | Uint8Array): Promise<string> {
    const safePath = this.safePath(relativePath);
    const bytes = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
    if (bytes > this.maxBytes) throw new Error(`Artifact exceeds ${this.maxBytes} byte limit`);
    const destination = join(this.root, safePath);
    const relativeDestination = relative(this.root, destination);
    if (relativeDestination.startsWith('..')) throw new Error('Artifact path traversal is not allowed');
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, content, { flag: 'wx' });
    return safePath;
  }

  read(relativePath: string): Promise<Buffer> {
    return readFile(join(this.root, this.safePath(relativePath)));
  }

  private safePath(relativePath: string): string {
    const safePath = normalize(relativePath);
    if (!relativePath || safePath.startsWith('..') || safePath.includes(`..${'\\'}`) || safePath.includes(`..${'/'}`)) throw new Error('Artifact path traversal is not allowed');
    return safePath;
  }
}
