import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./retry";

describe("withRetry", () => {
  it("should succeed immediately if the function succeeds", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry up to the maximum attempts on failure and throw the last error", async () => {
    const error = new Error("transient error");
    const fn = vi.fn().mockRejectedValue(error);
    const onRetry = vi.fn();

    await expect(
      withRetry(fn, {
        attempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 5,
        onRetry,
      }),
    ).rejects.toThrow("transient error");

    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("should stop retrying if shouldRetry returns false", async () => {
    const error = new Error("fatal error");
    const fn = vi.fn().mockRejectedValue(error);
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(
      withRetry(fn, {
        attempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 5,
        shouldRetry,
      }),
    ).rejects.toThrow("fatal error");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  it("should recover and return the value if a subsequent attempt succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("err1"))
      .mockRejectedValueOnce(new Error("err2"))
      .mockResolvedValue("recovered");

    const result = await withRetry(fn, {
      attempts: 4,
      baseDelayMs: 1,
      maxDelayMs: 5,
    });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
