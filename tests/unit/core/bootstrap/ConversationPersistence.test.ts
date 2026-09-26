import {
  computeConversationInputDigest,
  CONVERSATION_INPUT_LEDGER_SCHEMA_VERSION,
  type ConversationInputLedger,
  ConversationInputLedgerStorage,
} from '@/core/bootstrap/ConversationInputLedgerStorage';
import { ConversationPersistenceStore } from '@/core/bootstrap/ConversationPersistenceStore';
import { SessionStorage } from '@/core/bootstrap/SessionStorage';
import {
  DELETION_MARKER_SUFFIX,
  DEVICE_SESSIONS_PATH,
  getDeviceSessionsPath,
  INPUT_LEDGER_SUFFIX,
  SESSIONS_PATH,
} from '@/core/bootstrap/storagePaths';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { SessionMetadata } from '@/core/types';

function createAdapter(): jest.Mocked<VaultFileAdapter> {
  return {
    delete: jest.fn().mockResolvedValue(undefined),
    ensureFolder: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(false),
    listFiles: jest.fn().mockResolvedValue([]),
    read: jest.fn(),
    rename: jest.fn().mockResolvedValue(undefined),
    write: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<VaultFileAdapter>;
}

const DEVICE_KEY = `device-${'a'.repeat(64)}`;
const DEVICE_PATH = `${DEVICE_SESSIONS_PATH}/${DEVICE_KEY}`;
const BETA_DEVICE_KEY = `device-${'b'.repeat(64)}`;
const DEVICE_DELETION_PATH = `${DEVICE_PATH}/conversation-1${DELETION_MARKER_SUFFIX}`;

function createMetadata(id: string): SessionMetadata {
  return {
    id,
    providerId: 'claude',
    title: `Conversation ${id}`,
    createdAt: 1,
    lastActivityAt: 2,
  };
}

function createLedger(conversationId = 'conversation-1'): ConversationInputLedger {
  return {
    schemaVersion: CONVERSATION_INPUT_LEDGER_SCHEMA_VERSION,
    conversationId,
    records: [
      {
        schemaVersion: CONVERSATION_INPUT_LEDGER_SCHEMA_VERSION,
        id: 'input-1',
        userTurnOrdinal: 1,
        state: 'staged',
        timestamp: 10,
        rawDisplayText: 'Hello',
        canonicalText: 'Hello',
        images: [],
        contentDigest: computeConversationInputDigest({
          visibleText: 'Hello',
          images: [],
        }),
      },
    ],
  };
}

describe('SessionStorage read boundary', () => {
  it('uses the filesystem-safe opaque device key as the metadata namespace', () => {
    expect(getDeviceSessionsPath(DEVICE_KEY)).toBe(DEVICE_PATH);
  });

  it('isolates metadata scans by device', async () => {
    const adapter = createAdapter();
    const alphaStorage = new SessionStorage(adapter, DEVICE_KEY);
    const betaStorage = new SessionStorage(adapter, BETA_DEVICE_KEY);
    const betaPath = getDeviceSessionsPath(BETA_DEVICE_KEY);
    const alpha = createMetadata('alpha-only');
    const beta = createMetadata('beta-only');
    adapter.listFiles.mockImplementation(async (path) => {
      if (path === DEVICE_PATH) return [`${DEVICE_PATH}/alpha-only.meta.json`];
      if (path === betaPath) return [`${betaPath}/beta-only.meta.json`];
      return [];
    });
    adapter.read.mockImplementation(async (path) => (
      JSON.stringify(path.includes('alpha-only') ? alpha : beta)
    ));

    await expect(alphaStorage.listMetadata()).resolves.toEqual([alpha]);
    await expect(betaStorage.listMetadata()).resolves.toEqual([beta]);
  });

  it('loads device metadata without writing', async () => {
    const adapter = createAdapter();
    const storage = new SessionStorage(adapter, DEVICE_KEY);
    const metadata = createMetadata('conversation-1');
    adapter.exists.mockImplementation(async path => (
      path === `${DEVICE_PATH}/conversation-1.meta.json`
    ));
    adapter.read.mockResolvedValue(JSON.stringify(metadata));

    await expect(storage.load('conversation-1')).resolves.toEqual({
      metadata,
      needsMigration: false,
    });
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.delete).not.toHaveBeenCalled();
  });

  it('suppresses scanned metadata that has a deletion marker', async () => {
    const adapter = createAdapter();
    const storage = new SessionStorage(adapter, DEVICE_KEY);
    adapter.listFiles.mockImplementation(async (path) => (
      path === DEVICE_PATH
        ? [
            `${DEVICE_PATH}/deleted${DELETION_MARKER_SUFFIX}`,
            `${DEVICE_PATH}/deleted.meta.json`,
            `${DEVICE_PATH}/visible.meta.json`,
          ]
        : []
    ));
    adapter.read.mockImplementation(async (path) => {
      const id = path.includes('visible') ? 'visible' : 'deleted';
      return JSON.stringify(createMetadata(id));
    });

    const result = await storage.scan();

    expect(result.records).toEqual([
      {
        metadata: createMetadata('visible'),
        needsMigration: false,
      },
    ]);
    expect(adapter.read).not.toHaveBeenCalledWith(
      `${DEVICE_PATH}/deleted.meta.json`,
    );
  });

  it('fails closed when the device metadata folder cannot be listed', async () => {
    const adapter = createAdapter();
    const storage = new SessionStorage(adapter, DEVICE_KEY);
    adapter.listFiles.mockRejectedValue(new Error('listing failed'));

    await expect(storage.scan()).resolves.toEqual({
      records: [],
      complete: false,
      invalidMetadataCount: 0,
    });
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it('suppresses an explicit load when a durable deletion marker exists', async () => {
    const adapter = createAdapter();
    const storage = new SessionStorage(adapter, DEVICE_KEY);
    adapter.exists.mockImplementation(async (path) => (
      path === `${DEVICE_PATH}/deleted${DELETION_MARKER_SUFFIX}`
      || path === `${DEVICE_PATH}/deleted.meta.json`
    ));

    await expect(storage.load('deleted')).resolves.toBeNull();
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it('normalizes a non-canonical Linked content path and flags a rewrite', async () => {
    const adapter = createAdapter();
    const storage = new SessionStorage(adapter, DEVICE_KEY);
    adapter.exists.mockImplementation(async (path) => (
      path === `${DEVICE_PATH}/canonical-content.meta.json`
    ));
    adapter.read.mockResolvedValue(JSON.stringify({
      ...createMetadata('canonical-content'),
      linkedContentPath: './Projects//Current',
    }));

    await expect(storage.load('canonical-content')).resolves.toEqual({
      metadata: {
        ...createMetadata('canonical-content'),
        linkedContentPath: 'Projects/Current',
      },
      needsMigration: true,
    });
  });

  it('drops an invalid Linked content path and flags a rewrite', async () => {
    const adapter = createAdapter();
    const storage = new SessionStorage(adapter, DEVICE_KEY);
    adapter.exists.mockImplementation(async (path) => (
      path === `${DEVICE_PATH}/invalid-content.meta.json`
    ));
    adapter.read.mockResolvedValue(JSON.stringify({
      ...createMetadata('invalid-content'),
      linkedContentPath: '../escape',
    }));

    await expect(storage.load('invalid-content')).resolves.toEqual({
      metadata: createMetadata('invalid-content'),
      needsMigration: true,
    });
  });
});

describe('ConversationInputLedgerStorage', () => {
  it('saves and lazily loads a versioned ledger sidecar', async () => {
    const adapter = createAdapter();
    const storage = new ConversationInputLedgerStorage(adapter);
    const ledger = createLedger();
    adapter.exists.mockResolvedValueOnce(false);

    await expect(storage.load(ledger.conversationId)).resolves.toEqual({
      status: 'missing',
    });
    expect(adapter.read).not.toHaveBeenCalled();

    await storage.save(ledger.conversationId, ledger);
    expect(adapter.write).toHaveBeenCalledWith(
      `${SESSIONS_PATH}/${ledger.conversationId}${INPUT_LEDGER_SUFFIX}`,
      expect.any(String),
    );

    const persisted = adapter.write.mock.calls[0][1];
    adapter.exists.mockResolvedValue(true);
    adapter.read.mockResolvedValue(persisted);
    await expect(storage.load(ledger.conversationId)).resolves.toEqual({
      status: 'loaded',
      ledger,
      needsMigration: false,
    });
  });

  it('normalizes a non-canonical Linked content path without rewriting the ledger', async () => {
    const adapter = createAdapter();
    const storage = new ConversationInputLedgerStorage(adapter);
    const ledger = createLedger();
    const raw = {
      ...ledger,
      records: [{
        ...ledger.records[0],
        context: {
          linkedContent: { path: 'Notes\\Plan.md', content: 'body' },
        },
      }],
    };
    adapter.exists.mockResolvedValue(true);
    adapter.read.mockResolvedValue(JSON.stringify(raw));

    const result = await storage.load(ledger.conversationId);

    expect(result).toEqual({
      status: 'loaded',
      ledger: {
        ...ledger,
        records: [{
          ...ledger.records[0],
          context: {
            linkedContent: { path: 'Notes/Plan.md', content: 'body' },
          },
        }],
      },
      needsMigration: true,
    });
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('drops an invalid Linked content context', async () => {
    const adapter = createAdapter();
    const storage = new ConversationInputLedgerStorage(adapter);
    const ledger = createLedger();
    const raw = {
      ...ledger,
      records: [{
        ...ledger.records[0],
        context: {
          linkedContent: { path: '../escape' },
          editorSelection: null,
        },
      }],
    };
    adapter.exists.mockResolvedValue(true);
    adapter.read.mockResolvedValue(JSON.stringify(raw));

    const result = await storage.load(ledger.conversationId);

    expect(result).toEqual({
      status: 'loaded',
      ledger: {
        ...ledger,
        records: [{
          ...ledger.records[0],
          context: { editorSelection: null },
        }],
      },
      needsMigration: true,
    });
  });

  it('reports malformed and unsupported ledgers without overwriting them', async () => {
    const adapter = createAdapter();
    const storage = new ConversationInputLedgerStorage(adapter);
    adapter.exists.mockResolvedValue(true);
    adapter.read
      .mockResolvedValueOnce('{not-json')
      .mockResolvedValueOnce(JSON.stringify({
        ...createLedger(),
        schemaVersion: 99,
      }));

    await expect(storage.load('conversation-1')).resolves.toEqual({
      status: 'unavailable',
      reason: 'malformed',
    });
    await expect(storage.load('conversation-1')).resolves.toEqual({
      status: 'unavailable',
      reason: 'unsupported-version',
    });
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '.',
    '..',
    '../escape',
    'nested/id',
    'nested\\id',
    '/absolute',
    '%2Fescape',
  ])('rejects unsafe conversation ID %p before ledger I/O', async (id) => {
    const adapter = createAdapter();
    const storage = new ConversationInputLedgerStorage(adapter);

    await expect(storage.load(id)).rejects.toThrow('Invalid session metadata id');
    await expect(storage.save(id, createLedger(id))).rejects.toThrow(
      'Invalid session metadata id',
    );
    await expect(storage.delete(id)).rejects.toThrow('Invalid session metadata id');
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.delete).not.toHaveBeenCalled();
  });

  it('builds a stable versioned digest from normalized text and ordered attachment hashes', () => {
    const image = {
      id: 'image-1',
      name: 'image.png',
      mediaType: 'image/png' as const,
      data: 'aW1hZ2U=',
      size: 5,
      source: 'paste' as const,
    };

    expect(computeConversationInputDigest({
      visibleText: 'line 1\r\nline 2',
      images: [image],
    })).toBe(computeConversationInputDigest({
      visibleText: 'line 1\nline 2',
      images: [{ ...image, id: 'different-local-id', name: 'renamed.png' }],
    }));
    expect(computeConversationInputDigest({
      visibleText: 'line 1\nline 2',
      images: [image],
    })).not.toBe(computeConversationInputDigest({
      visibleText: 'line 1\nline 2 changed',
      images: [image],
    }));
  });
});

describe('ConversationPersistenceStore', () => {
  it('serializes metadata only through the repository persistence boundary', async () => {
    const adapter = createAdapter();
    const store = new ConversationPersistenceStore(adapter, DEVICE_KEY);
    const metadata = {
      id: 'conversation-1',
      providerId: 'claude' as const,
      title: 'Persisted conversation',
      createdAt: 1,
      lastActivityAt: 2,
      linkedContentPath: 'Notes/current.md',
    };

    await store.saveMetadata(metadata);

    expect(adapter.write).toHaveBeenCalledWith(
      `${DEVICE_PATH}/conversation-1.meta.json`,
      JSON.stringify(metadata, null, 2),
    );
  });

  it('writes deletion markers inside the device namespace', async () => {
    const adapter = createAdapter();
    const store = new ConversationPersistenceStore(adapter, DEVICE_KEY);

    await store.markDeleted('conversation-1', 123);

    expect(adapter.write.mock.calls).toEqual([
      [
        DEVICE_DELETION_PATH,
        JSON.stringify({
          schemaVersion: 1,
          conversationId: 'conversation-1',
          deletedAt: 123,
        }, null, 2),
      ],
    ]);
    expect(adapter.delete).not.toHaveBeenCalledWith(
      DEVICE_DELETION_PATH,
    );
  });

  it('deletes metadata and ledger through separate ordered operations', async () => {
    const adapter = createAdapter();
    const store = new ConversationPersistenceStore(adapter, DEVICE_KEY);

    await store.deleteMetadata('conversation-1');
    await store.deleteInputLedger('conversation-1');

    expect(adapter.delete.mock.calls.map(([path]) => path)).toEqual([
      `${DEVICE_PATH}/conversation-1.meta.json`,
      `${SESSIONS_PATH}/conversation-1${INPUT_LEDGER_SUFFIX}`,
    ]);
  });
});
