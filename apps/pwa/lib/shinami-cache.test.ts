import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtlCache } from "./shinami-cache";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should store and retrieve values within TTL", () => {
    const cache = new TtlCache<string>(5, 1000);
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("should evict entries when they expire", () => {
    const cache = new TtlCache<string>(5, 1000);
    cache.set("key1", "value1");

    vi.advanceTimersByTime(1001);

    expect(cache.get("key1")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("should evict the oldest entry (LRU) when capacity is exceeded", () => {
    const cache = new TtlCache<string>(3, 1000);
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.set("key3", "value3");

    // This should evict key1
    cache.set("key4", "value4");

    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBe("value2");
    expect(cache.get("key3")).toBe("value3");
    expect(cache.get("key4")).toBe("value4");
  });

  it("should refresh LRU order on get", () => {
    const cache = new TtlCache<string>(3, 1000);
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.set("key3", "value3");

    // Access key1 to refresh it
    expect(cache.get("key1")).toBe("value1");

    // Set key4, which should now evict key2 (oldest unaccessed entry)
    cache.set("key4", "value4");

    expect(cache.get("key2")).toBeUndefined();
    expect(cache.get("key1")).toBe("value1");
    expect(cache.get("key3")).toBe("value3");
    expect(cache.get("key4")).toBe("value4");
  });

  it("should delete values correctly", () => {
    const cache = new TtlCache<string>(5, 1000);
    cache.set("key1", "value1");
    cache.delete("key1");
    expect(cache.get("key1")).toBeUndefined();
  });

  it("should clear the cache correctly", () => {
    const cache = new TtlCache<string>(5, 1000);
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("key1")).toBeUndefined();
  });
});
