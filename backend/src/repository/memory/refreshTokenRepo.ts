import { RefreshTokenRecord } from '../../domain/types';
import { IRefreshTokenRepo } from '../interfaces';

export class InMemoryRefreshTokenRepo implements IRefreshTokenRepo {
  private readonly tokens = new Map<string, RefreshTokenRecord>();

  async create(record: RefreshTokenRecord): Promise<RefreshTokenRecord> {
    this.tokens.set(record.token, record);
    return record;
  }

  async findByToken(token: string): Promise<RefreshTokenRecord | null> {
    return this.tokens.get(token) ?? null;
  }

  async findActiveByActorId(actorId: string): Promise<RefreshTokenRecord[]> {
    const now = Date.now();
    return [...this.tokens.values()]
      .filter((t) => t.actorId === actorId && !t.revoked && t.expiresAt.getTime() > now)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async revoke(token: string): Promise<void> {
    const record = this.tokens.get(token);
    if (record) this.tokens.set(token, { ...record, revoked: true });
  }
}
