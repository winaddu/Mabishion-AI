import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn(async () => ({ rowsAffected: 1 }));

vi.mock('../../data/core.js', () => ({
  getDb: vi.fn(async () => ({ execute }))
}));
vi.mock('../../data/system.js', () => ({ logAudit: vi.fn(async () => {}) }));

const { addApproval } = await import('../../data/approvals.js');

describe('addApproval risk tier normalization', () => {
  beforeEach(() => execute.mockClear());

  it.each(['High', 'HIGH', 'Critical', 'critical'])('stores %s as critical', async (risk) => {
    await addApproval('preview', 'File Action', '{}', 'Cortex', risk);
    expect(execute.mock.calls[0][1][2]).toBe('critical');
  });

  it('keeps standard actions in the standard tier', async () => {
    await addApproval('preview', 'Draft', '{}', 'Cortex', 'Standard');
    expect(execute.mock.calls[0][1][2]).toBe('standard');
  });
});
