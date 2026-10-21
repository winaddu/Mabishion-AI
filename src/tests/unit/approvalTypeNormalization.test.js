import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn(async () => ({ rowsAffected: 1 }));

vi.mock('../../data/core.js', () => ({
  getDb: vi.fn(async () => ({ execute }))
}));
vi.mock('../../data/system.js', () => ({ logAudit: vi.fn(async () => {}) }));

const { addApproval } = await import('../../data/approvals.js');

describe('addApproval risk tier normalization', () => {
  beforeEach(() => execute.mockClear());

  it.each(['High', 'HIGH', 'Critical', 'critical'])('stores %s as critical with null expires_at', async (risk) => {
    await addApproval('preview', 'File Action', '{}', 'Cortex', risk);
    expect(execute.mock.calls[0][1][2]).toBe('critical');
    expect(execute.mock.calls[0][1][7]).toBeNull();
  });

  it('keeps standard actions in the standard tier with 24h expires_at', async () => {
    await addApproval('preview', 'Draft', '{}', 'Cortex', 'Standard');
    expect(execute.mock.calls[0][1][2]).toBe('standard');
    const expiresAt = execute.mock.calls[0][1][7];
    expect(typeof expiresAt).toBe('string');
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });
});
