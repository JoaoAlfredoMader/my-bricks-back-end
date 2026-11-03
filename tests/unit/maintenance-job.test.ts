import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MaintenanceDeps, type MaintenanceReport, startMaintenanceJob } from "../../src/modules/maintenance/maintenance.js";

const EMPTY: MaintenanceReport = { expiredDemoOrganizations: 0, anonymousUsersRemoved: 0, orphanFilesSwept: 0, auditEntriesPurged: 0, expiredSessionsPurged: 0, expiredVerificationsPurged: 0 };
const deps = { prisma: {} as MaintenanceDeps["prisma"], storage: {} as MaintenanceDeps["storage"] };

describe("the maintenance job", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("runs once right away and then every interval", async () => {
    const run = vi.fn().mockResolvedValue(EMPTY);
    const stop = startMaintenanceJob({ ...deps, intervalMinutes: 10, run, log: () => {} });

    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(run).toHaveBeenCalledTimes(4);
    stop();
  });

  it("stops when asked", async () => {
    const run = vi.fn().mockResolvedValue(EMPTY);
    const stop = startMaintenanceJob({ ...deps, intervalMinutes: 1, run, log: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never overlaps: a tick that arrives while a run is still going does nothing", async () => {
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<MaintenanceReport>((resolve) => (release = () => resolve(EMPTY))));
    const stop = startMaintenanceJob({ ...deps, intervalMinutes: 1, run, log: () => {} });

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("survives a failing run and tries again on the next tick", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValueOnce(new Error("database is down")).mockResolvedValue(EMPTY);
    const stop = startMaintenanceJob({ ...deps, intervalMinutes: 1, run, log: () => {} });

    await vi.advanceTimersByTimeAsync(0);
    expect(logged).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    logged.mockRestore();
  });

  it("logs only the runs that did something", async () => {
    const log = vi.fn();
    const run = vi.fn().mockResolvedValueOnce(EMPTY).mockResolvedValueOnce({ ...EMPTY, expiredDemoOrganizations: 2 });
    const stop = startMaintenanceJob({ ...deps, intervalMinutes: 1, run, log });

    await vi.advanceTimersByTimeAsync(0);
    expect(log).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toContain('"expiredDemoOrganizations":2');
    stop();
  });

  it("hands each run the current moment", async () => {
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    const run = vi.fn().mockResolvedValue(EMPTY);
    const stop = startMaintenanceJob({ ...deps, intervalMinutes: 60, run, log: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect((run.mock.calls[0]![0] as MaintenanceDeps).now?.toISOString()).toBe("2026-11-03T12:00:00.000Z");
    expect((run.mock.calls[1]![0] as MaintenanceDeps).now?.toISOString()).toBe("2026-11-03T13:00:00.000Z");
    stop();
  });
});
