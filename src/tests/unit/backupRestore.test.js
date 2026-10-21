import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, getPreviewSnapshotMock, restorePreviewSnapshotMock, savePreviewMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getPreviewSnapshotMock: vi.fn(),
  restorePreviewSnapshotMock: vi.fn(),
  savePreviewMock: vi.fn(),
}));

vi.mock('../../data/core.js', () => ({
  getDb: getDbMock,
  getDevelopmentPreviewDbSnapshot: getPreviewSnapshotMock,
  restoreDevelopmentPreviewDbSnapshot: restorePreviewSnapshotMock,
  saveDevelopmentPreviewDb: savePreviewMock,
}));

import { backupDatabase, restoreDatabase, validateBackupIntegrity } from '../../data/security.js';

const tableNames = ['approvals', 'leads', 'projects', 'settings', 'new_feature_data'];
const tableColumns = {
  approvals: ['id', 'status'],
  leads: ['id', 'name'],
  projects: ['id', 'name'],
  settings: ['key', 'value'],
  new_feature_data: ['id', 'payload'],
};

function makeDb({ rows = {}, throwOnRead = null } = {}) {
  const execute = vi.fn(async () => ({ rowsAffected: 1 }));
  const select = vi.fn(async (query) => {
    if (query.includes('pragma_table_list')) return tableNames.map(name => ({ name }));
    if (query.startsWith('PRAGMA table_info(')) {
      const name = query.match(/PRAGMA table_info\("([^"]+)"\)/)?.[1];
      return (tableColumns[name] || []).map((name, cid) => ({ name, cid }));
    }
    const table = query.match(/^SELECT \* FROM "([^"]+)"$/)?.[1];
    if (table === throwOnRead) throw new Error(`read failed: ${table}`);
    return rows[table] || [];
  });
  return { execute, select };
}

describe('database backup and restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.window = { __TAURI_INTERNALS__: {} };
  });

  it('backs up every user table reported by SQLite, including tables added later', async () => {
    const db = makeDb({ rows: { new_feature_data: [{ id: 'x', payload: 'kept' }] } });
    getDbMock.mockResolvedValue(db);

    const backup = JSON.parse(await backupDatabase());

    expect(Object.keys(backup)).toEqual([...tableNames].sort());
    expect(backup.new_feature_data).toEqual([{ id: 'x', payload: 'kept' }]);
  });

  it('backs up and restores the local development preview store without SQLite introspection', async () => {
    const previewData = { projects: [], leads: [], approvals: [], settings: [], custom_preview_rows: [{ id: 'p1' }] };
    globalThis.window = {};
    getPreviewSnapshotMock.mockReturnValue(previewData);

    expect(JSON.parse(await backupDatabase())).toEqual(previewData);
    await expect(restoreDatabase(JSON.stringify(previewData))).resolves.toBe(true);
    expect(restorePreviewSnapshotMock).toHaveBeenCalledWith(previewData);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it('fails instead of producing a backup with an unreadable table silently emptied', async () => {
    getDbMock.mockResolvedValue(makeDb({ throwOnRead: 'leads' }));

    await expect(backupDatabase()).rejects.toThrow('read failed: leads');
  });

  it('rejects non-array table data during integrity validation', () => {
    const result = validateBackupIntegrity(JSON.stringify({
      projects: [], leads: [], approvals: [], settings: [], new_feature_data: { id: 'x' },
    }));

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('new_feature_data');
  });

  it('refuses unknown tables before executing any destructive SQL', async () => {
    const db = makeDb();
    getDbMock.mockResolvedValue(db);
    const backup = JSON.stringify({ projects: [], leads: [], approvals: [], settings: [], 'projects; DROP TABLE users;--': [] });

    await expect(restoreDatabase(backup)).rejects.toThrow('tables unavailable');
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('refuses unknown columns before executing any destructive SQL', async () => {
    const db = makeDb();
    getDbMock.mockResolvedValue(db);
    const backup = JSON.stringify({
      projects: [{ 'name) VALUES (1); DROP TABLE users;--': 'x' }],
      leads: [], approvals: [], settings: [],
    });

    await expect(restoreDatabase(backup)).rejects.toThrow('unknown columns');
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('restores valid rows with parameterized values and validated identifiers', async () => {
    const db = makeDb();
    getDbMock.mockResolvedValue(db);
    const payload = "Client's name; DROP TABLE users;--";
    const backup = JSON.stringify({
      projects: [{ id: 'p1', name: payload }],
      leads: [], approvals: [], settings: [],
    });

    await expect(restoreDatabase(backup)).resolves.toBe(true);

    expect(db.execute).toHaveBeenCalledWith('INSERT INTO "projects" ("id", "name") VALUES ($1, $2)', ['p1', payload]);
    expect(db.execute).toHaveBeenCalledWith('DELETE FROM "leads"', []);
  });
});
