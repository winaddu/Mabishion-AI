import { beforeEach, describe, expect, it, vi } from 'vitest';

const order = [];
const osCreate = vi.fn(async () => { order.push('create'); return 'created'; });
const osWrite = vi.fn(async () => { order.push('write'); return 'written'; });
const osDelete = vi.fn(async () => { order.push('delete'); return 'deleted'; });
const osShell = vi.fn(async () => { order.push('shell'); return 'ran'; });
const addApproval = vi.fn(async () => 'critical-approval');
const emit = vi.fn(async () => { order.push('emit'); });
const waitForResolution = vi.fn(async () => { order.push('approved'); return { status: 'approved' }; });

vi.mock('../../engine/bridge.js', () => ({
  OS: { create: osCreate, read: vi.fn(), write: osWrite, delete: osDelete, shell: osShell }
}));
vi.mock('../../data/db.js', () => ({
  getSetting: vi.fn(async () => null), addApproval, getDb: vi.fn(), logSearchFailure: vi.fn()
}));
vi.mock('@tauri-apps/api/event', () => ({ emit }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
vi.mock('../../services/searchService.js', () => ({ SearchService: { performSearch: vi.fn() } }));
vi.mock('../../engine/workers/index.js', () => ({ runWorker: vi.fn() }));
vi.mock('../../services/whatsappService.js', () => ({ WhatsAppService: { sendTemplate: vi.fn(async () => {}) } }));
vi.mock('../../services/approvalEngine.js', () => ({
  ApprovalEngine: { waitForResolution }
}));

const { AgentRuntime } = await import('../../engine/runtime.js');
const runtime = new AgentRuntime();

describe('runtime critical action gate', () => {
  beforeEach(() => {
    order.length = 0;
    vi.clearAllMocks();
    addApproval.mockResolvedValue('critical-approval');
    waitForResolution.mockImplementation(async () => { order.push('approved'); return { status: 'approved' }; });
  });

  it.each([
    ['mickii_fs_create', { path: '/tmp/a.txt', kind: 'file', content: 'x' }, osCreate, 'create'],
    ['mickii_fs_write', { path: '/tmp/a.txt', content: 'x' }, osWrite, 'write'],
    ['mickii_fs_delete', { path: '/tmp/a.txt' }, osDelete, 'delete'],
    ['mickii_shell_run', { command: 'echo', args: ['safe'] }, osShell, 'shell']
  ])('%s waits for approval before executing the OS action', async (tool, args, operation, marker) => {
    await runtime.dispatch(tool, args);
    expect(addApproval).toHaveBeenCalledWith(expect.any(String), expect.any(String), '{}', 'Cortex', 'Critical');
    expect(waitForResolution).toHaveBeenCalledWith('critical-approval');
    expect(order.indexOf('approved')).toBeLessThan(order.indexOf(marker));
    expect(operation).toHaveBeenCalledOnce();
  });

  it('does not execute a file write when the owner rejects it', async () => {
    waitForResolution.mockRejectedValueOnce(new Error('Owner rejected this action.'));
    await expect(runtime.dispatch('mickii_fs_write', { path: '/tmp/a.txt', content: 'x' }))
      .rejects.toThrow('Owner rejected this action.');
    expect(osWrite).not.toHaveBeenCalled();
  });
});
