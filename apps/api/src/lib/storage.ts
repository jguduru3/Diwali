import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { env } from './env';

/**
 * Two stores (SPEC §10): `licences` is PRIVATE — licence photos are only read
 * back through the admin-only API. `shop-media` holds product photos, served
 * publicly through GET /api/media. In Azure these are blob containers reached
 * with the Function App's managed identity; locally (no STORAGE_ACCOUNT_NAME)
 * files go to UPLOAD_DIR or ./.uploads.
 */
export interface FileStore {
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<{ data: Buffer; contentType: string } | null>;
}

export type Container = 'licences' | 'shop-media';

class BlobStore implements FileStore {
  private readonly client: BlobServiceClient;
  constructor(
    account: string,
    private readonly container: Container,
  ) {
    this.client = new BlobServiceClient(
      `https://${account}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
  }
  async put(path: string, data: Buffer, contentType: string) {
    await this.client
      .getContainerClient(this.container)
      .getBlockBlobClient(path)
      .uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
  }
  async get(path: string) {
    const blob = this.client.getContainerClient(this.container).getBlockBlobClient(path);
    if (!(await blob.exists())) return null;
    const props = await blob.getProperties();
    return { data: await blob.downloadToBuffer(), contentType: props.contentType ?? 'image/jpeg' };
  }
}

class LocalStore implements FileStore {
  private readonly root: string;
  constructor(container: Container) {
    this.root = resolve(env.uploadDir() ?? '.uploads', container);
  }
  private file(path: string) {
    const full = resolve(this.root, path);
    if (!full.startsWith(this.root)) throw new Error('Invalid path');
    return full;
  }
  async put(path: string, data: Buffer, contentType: string) {
    const full = this.file(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    await writeFile(`${full}.type`, contentType);
  }
  async get(path: string) {
    try {
      const full = this.file(path);
      const [data, contentType] = await Promise.all([
        readFile(full),
        readFile(`${full}.type`, 'utf8').catch(() => 'image/jpeg'),
      ]);
      return { data, contentType };
    } catch {
      return null;
    }
  }
}

const stores = new Map<Container, FileStore>();
export function fileStore(container: Container = 'licences'): FileStore {
  let store = stores.get(container);
  if (!store) {
    const account = env.storageAccountName();
    store = account ? new BlobStore(account, container) : new LocalStore(container);
    stores.set(container, store);
  }
  return store;
}

/** Product photo path in shop-media; a new name per upload so caches never go stale. */
export const itemImagePath = (shopId: string, id: string, ext: string) =>
  `items/${shopId}/${id}.${ext}`;

export const licenceBlobPath = (shopId: string, id: string, ext: string) =>
  join(shopId, `${id}.${ext}`).replace(/\\/g, '/');

/** Checks magic bytes so only real JPEG/PNG/WebP images are stored. */
export function sniffImage(data: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
