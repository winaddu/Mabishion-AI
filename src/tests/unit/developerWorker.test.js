import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, llm } = vi.hoisted(() => ({
  db: { select: vi.fn(), execute: vi.fn() },
  llm: vi.fn(),
}));
vi.mock('../../data/db.js', () => ({ getDb: async () => db }));
vi.mock('../../services/llmManager.js', () => ({ executeLlmWithFallback: llm }));

import { DeveloperWorker } from '../../engine/workers/developerWorker.js';

describe('DeveloperWorker generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.select.mockImplementation(async sql => sql.includes('FROM projects')
      ? [{ id: 'project-1', name: 'Clinic booking', type: 'Website', client_name: 'Clinic' }]
      : []);
    db.execute.mockResolvedValue({ rowsAffected: 1 });
    llm.mockResolvedValueOnce(JSON.stringify({
      mainComponent: { filename: 'ClinicBooking.jsx', code: 'export default function ClinicBooking() { return null; }' },
    })).mockResolvedValueOnce('test("renders clinic booking", () => {});');
  });

  it('generates and persists a module for an existing project', async () => {
    const result = await new DeveloperWorker().execute('project-1');
    expect(result.mainFilename).toBe('ClinicBooking.jsx');
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO code_modules'),
      expect.arrayContaining(['project-1', 'ClinicBooking.jsx', 'export default function ClinicBooking() { return null; }']),
    );
  });

  it.each(['', '{}', '{"mainComponent":{"filename":"Clinic.jsx","code":""}}'])
    ('rejects missing source instead of persisting a dummy module (%s)', async response => {
      llm.mockReset().mockResolvedValue(response);
      await expect(new DeveloperWorker().execute('project-1')).rejects.toThrow(/source|generation|validation/i);
      expect(db.execute).not.toHaveBeenCalled();
    });
});
