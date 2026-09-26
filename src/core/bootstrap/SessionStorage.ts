import { mapWithConcurrency } from '../../utils/concurrency';
import { normalizeLinkedContentPath } from '../path/LinkedContentPath';
import {
  DEFAULT_CHAT_PROVIDER_ID,
  type SessionMetadataListOptions,
  type SessionMetadataScanResult,
} from '../providers/types';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type {
  ConversationMeta,
  ConversationModelRecoverySource,
  SessionMetadata,
} from '../types';
import {
  DELETION_MARKER_SUFFIX,
  getDeviceSessionsPath,
} from './storagePaths';

const SAFE_METADATA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SESSION_METADATA_READ_CONCURRENCY = 8;
const SESSION_METADATA_PUBLISH_BATCH_SIZE = 16;
const METADATA_SUFFIX = '.meta.json';

export interface SessionMetadataReadResult {
  metadata: SessionMetadata;
  /** True when the stored file held values that were normalized on read. */
  needsMigration: boolean;
}

export interface SessionMetadataReadScanResult {
  records: SessionMetadataReadResult[];
  complete: boolean;
  invalidMetadataCount: number;
}

export interface SessionMetadataReadOptions {
  onBatch?: (records: SessionMetadataReadResult[]) => void;
  batchSize?: number;
}

export interface SessionMetadataReader {
  load(id: string): Promise<SessionMetadataReadResult | null>;
  scan(options?: SessionMetadataReadOptions): Promise<SessionMetadataReadScanResult>;
  loadMetadata(id: string): Promise<SessionMetadata | null>;
  scanMetadata(options?: SessionMetadataListOptions): Promise<SessionMetadataScanResult>;
  listMetadata(options?: SessionMetadataListOptions): Promise<SessionMetadata[]>;
}

export function isValidSessionMetadataId(id: string): boolean {
  return SAFE_METADATA_ID_PATTERN.test(id)
    && id !== '.'
    && id !== '..'
    && !/%(?:2f|5c)/i.test(id);
}

export function assertValidSessionMetadataId(id: string): void {
  if (!isValidSessionMetadataId(id)) {
    throw new Error(`Invalid session metadata id: ${JSON.stringify(id)}`);
  }
}

export class SessionStorage implements SessionMetadataReader {
  private readonly deviceSessionsPath: string;

  constructor(
    private readonly adapter: VaultFileAdapter,
    deviceKey: string,
  ) {
    this.deviceSessionsPath = getDeviceSessionsPath(deviceKey);
  }

  getMetadataPath(id: string): string {
    assertValidSessionMetadataId(id);
    return `${this.deviceSessionsPath}/${id}${METADATA_SUFFIX}`;
  }

  getDeletionMarkerPath(id: string): string {
    assertValidSessionMetadataId(id);
    return `${this.deviceSessionsPath}/${id}${DELETION_MARKER_SUFFIX}`;
  }

  async load(id: string): Promise<SessionMetadataReadResult | null> {
    if (!isValidSessionMetadataId(id)) {
      return null;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await this.loadOnce(id);
        if (result || attempt === 1) {
          return result;
        }
      } catch {
        if (attempt === 1) {
          return null;
        }
      }
    }
    return null;
  }

  private async loadOnce(id: string): Promise<SessionMetadataReadResult | null> {
    const metadataPath = this.getMetadataPath(id);
    const [hasMetadata, isDeleted] = await Promise.all([
      this.adapter.exists(metadataPath),
      this.adapter.exists(this.getDeletionMarkerPath(id)),
    ]);
    if (!hasMetadata || isDeleted) return null;
    return this.readMetadata(metadataPath, id);
  }

  async loadMetadata(id: string): Promise<SessionMetadata | null> {
    return (await this.load(id))?.metadata ?? null;
  }

  async scan(
    options: SessionMetadataReadOptions = {},
  ): Promise<SessionMetadataReadScanResult> {
    const listing = await this.listFiles(this.deviceSessionsPath);
    if (!listing.complete) {
      return {
        records: [],
        complete: false,
        invalidMetadataCount: 0,
      };
    }

    const deletedIds = new Set(
      this.indexPathsById(listing.files, DELETION_MARKER_SUFFIX).keys(),
    );
    const metadataPaths = this.indexPathsById(listing.files, METADATA_SUFFIX);
    let complete = true;
    let invalidMetadataCount = 0;

    const pendingBatch: SessionMetadataReadResult[] = [];
    const batchSize = Math.max(
      1,
      options.batchSize ?? SESSION_METADATA_PUBLISH_BATCH_SIZE,
    );
    const publish = (record: SessionMetadataReadResult): void => {
      if (!options.onBatch) return;
      pendingBatch.push(record);
      if (pendingBatch.length >= batchSize) {
        options.onBatch(pendingBatch.splice(0, pendingBatch.length));
      }
    };
    const entries = [...metadataPaths.entries()].filter(([id]) => !deletedIds.has(id));
    const records = await mapWithConcurrency(
      entries,
      async ([id, path]) => {
        let record: SessionMetadataReadResult | null;
        try {
          record = await this.readMetadata(path, id);
        } catch {
          complete = false;
          return null;
        }
        if (!record) {
          invalidMetadataCount += 1;
          return null;
        }
        publish(record);
        return record;
      },
      SESSION_METADATA_READ_CONCURRENCY,
    );

    if (pendingBatch.length > 0) {
      options.onBatch?.(pendingBatch.splice(0, pendingBatch.length));
    }

    return {
      records: records.filter(
        (record): record is SessionMetadataReadResult => record !== null,
      ),
      complete,
      invalidMetadataCount,
    };
  }

  async scanMetadata(
    options: SessionMetadataListOptions = {},
  ): Promise<SessionMetadataScanResult> {
    const result = await this.scan({
      batchSize: options.batchSize,
      onBatch: options.onBatch
        ? (records) => options.onBatch?.(records.map(({ metadata }) => metadata))
        : undefined,
    });
    return {
      metadata: result.records.map(({ metadata }) => metadata),
      complete: result.complete,
      invalidMetadataCount: result.invalidMetadataCount,
    };
  }

  async listMetadata(
    options: SessionMetadataListOptions = {},
  ): Promise<SessionMetadata[]> {
    return (await this.scanMetadata(options)).metadata;
  }

  async listAllConversations(): Promise<ConversationMeta[]> {
    const nativeMetas = await this.listMetadata();
    const metas: ConversationMeta[] = nativeMetas.map((meta) => ({
      id: meta.id,
      providerId: meta.providerId ?? DEFAULT_CHAT_PROVIDER_ID,
      selectedModel: meta.selectedModel,
      title: meta.title,
      createdAt: meta.createdAt,
      lastActivityAt: meta.lastActivityAt,
      messageCount: 0,
      preview: 'SDK session',
      linkedContentPath: meta.linkedContentPath,
      isPinned: meta.isPinned,
      isArchived: meta.isArchived,
      titleGenerationStatus: meta.titleGenerationStatus,
    }));
    return metas.sort(
      (left, right) =>
        right.lastActivityAt - left.lastActivityAt,
    );
  }

  private async readMetadata(
    path: string,
    expectedId: string,
  ): Promise<SessionMetadataReadResult | null> {
    const content = await this.adapter.read(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const rawMetadata = parsed as Record<string, unknown>;
    if (
      rawMetadata.id !== expectedId
      || typeof rawMetadata.id !== 'string'
      || !isValidSessionMetadataId(rawMetadata.id)
    ) {
      return null;
    }
    const lastActivityAt = this.getFirstFiniteTimestamp(
      rawMetadata.lastActivityAt,
      rawMetadata.createdAt,
    ) ?? 0;
    const {
      selectedModel: rawSelectedModel,
      modelRecoverySource: rawModelRecoverySource,
      linkedContentPath: rawLinkedContentPath,
      ...metadataFields
    } = rawMetadata;
    const selectedModel = typeof rawSelectedModel === 'string'
      ? rawSelectedModel
      : undefined;
    const modelRecoverySource = this.parseModelRecoverySource(rawModelRecoverySource);
    const linkedContentPath = normalizeLinkedContentPath(rawLinkedContentPath) ?? undefined;
    const metadata = {
      ...metadataFields,
      ...(selectedModel !== undefined ? { selectedModel } : {}),
      ...(modelRecoverySource ? { modelRecoverySource } : {}),
      ...(linkedContentPath ? { linkedContentPath } : {}),
      lastActivityAt,
    } as unknown as SessionMetadata;
    const needsMigration = !Number.isFinite(rawMetadata.lastActivityAt)
      || (rawLinkedContentPath !== undefined && linkedContentPath !== rawLinkedContentPath)
      || (rawSelectedModel !== undefined && selectedModel === undefined)
      || (rawModelRecoverySource !== undefined && modelRecoverySource === undefined);
    return { metadata, needsMigration };
  }

  private parseModelRecoverySource(value: unknown): ConversationModelRecoverySource | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const source = value as Record<string, unknown>;
    if (typeof source.sessionId !== 'string' && source.sessionId !== null) return undefined;
    if (
      source.providerState !== undefined
      && (
        !source.providerState
        || typeof source.providerState !== 'object'
        || Array.isArray(source.providerState)
      )
    ) {
      return undefined;
    }
    if (
      source.resumeAtMessageId !== undefined
      && typeof source.resumeAtMessageId !== 'string'
    ) {
      return undefined;
    }
    return {
      sessionId: source.sessionId,
      ...(source.providerState
        ? { providerState: source.providerState as Record<string, unknown> }
        : {}),
      ...(typeof source.resumeAtMessageId === 'string'
        ? { resumeAtMessageId: source.resumeAtMessageId }
        : {}),
    };
  }

  private getFirstFiniteTimestamp(...values: unknown[]): number | undefined {
    return values.find((value): value is number => (
      typeof value === 'number' && Number.isFinite(value)
    ));
  }

  private async listFiles(
    folderPath: string,
  ): Promise<{ files: string[]; complete: boolean }> {
    try {
      return {
        files: await this.adapter.listFiles(folderPath),
        complete: true,
      };
    } catch {
      return { files: [], complete: false };
    }
  }

  private getIdFromPath(path: string, suffix: string): string | null {
    const fileName = path.split('/').at(-1) ?? path;
    return fileName.endsWith(suffix)
      ? fileName.slice(0, -suffix.length)
      : null;
  }

  private indexPathsById(
    files: readonly string[],
    suffix: string,
  ): Map<string, string> {
    const pathsById = new Map<string, string>();
    for (const path of files) {
      const id = this.getIdFromPath(path, suffix);
      if (id && isValidSessionMetadataId(id)) {
        pathsById.set(id, path);
      }
    }
    return pathsById;
  }
}
