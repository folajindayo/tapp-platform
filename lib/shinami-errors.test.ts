import { describe, it, expect } from "vitest";
import { mapShinamiError } from "./shinami-errors";

describe("mapShinamiError", () => {
  describe("HTTP error mapping", () => {
    it("should handle HTTP 401 unauthorized", () => {
      const err = mapShinamiError({ httpStatus: 401, context: "wallet" });
      expect(err.sessionExpired).toBe(false);
      expect(err.retryable).toBe(false);
      expect(err.userMessage).toContain("authentication failed");
    });

    it("should handle HTTP 429 rate limit", () => {
      const err = mapShinamiError({ httpStatus: 429, context: "wallet" });
      expect(err.retryable).toBe(true);
      expect(err.userMessage).toContain("busy");
    });

    it("should handle HTTP 5xx server errors", () => {
      const err = mapShinamiError({ httpStatus: 503, context: "wallet" });
      expect(err.retryable).toBe(true);
      expect(err.userMessage).toContain("issues");
    });
  });

  describe("JSON-RPC error mapping", () => {
    it("should handle RPC -32010 rate limit", () => {
      const err = mapShinamiError({
        httpStatus: 200,
        rpcError: { code: -32010, message: "Rate limit exceeded" },
        context: "wallet",
      });
      expect(err.retryable).toBe(true);
      expect(err.userMessage).toContain("rate-limited");
    });

    it("should handle RPC -32012 wallet-creation capacity for wallet context", () => {
      const err = mapShinamiError({
        httpStatus: 200,
        rpcError: { code: -32012, message: "Wallet quota exceeded" },
        context: "wallet",
      });
      expect(err.retryable).toBe(false);
      expect(err.userMessage).toContain("capacity");
    });

    it("should handle RPC -32012 rate-limiting for prover context", () => {
      const err = mapShinamiError({
        httpStatus: 200,
        rpcError: { code: -32012, message: "Prover quota exceeded" },
        context: "prover",
      });
      expect(err.retryable).toBe(true);
      expect(err.userMessage).toContain("attempts");
    });

    it("should map expired JWT to sessionExpired", () => {
      const err = mapShinamiError({
        httpStatus: 200,
        rpcError: { code: -32602, message: "jwt is expired" },
        context: "wallet",
      });
      expect(err.sessionExpired).toBe(true);
      expect(err.userMessage).toContain("expired");
    });

    it("should map nonce mismatch to sessionExpired", () => {
      const err = mapShinamiError({
        httpStatus: 200,
        rpcError: { code: -32602, message: "nonce does not match" },
        context: "wallet",
      });
      expect(err.sessionExpired).toBe(true);
      expect(err.userMessage).toContain("out of sync");
    });
  });
});
