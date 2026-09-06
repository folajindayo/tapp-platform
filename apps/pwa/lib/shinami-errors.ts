// Shinami error mapping — converts JSON-RPC + HTTP errors from Shinami
// into structured, UX-friendly errors the UI can render directly.
//
// Maintained per Shinami's published error reference:
// https://docs.shinami.com/developer-guides/core-integration-topics/error-reference

export interface ShinamiErrorPayload {
  /** HTTP status from Shinami (or our proxy). */
  httpStatus: number;
  /** JSON-RPC error code if Shinami returned one (HTTP 200 + error body). */
  rpcCode?: number;
  /** Raw error message from Shinami for debugging. */
  rawMessage?: string;
  /** Short user-facing string safe to render in the UI. */
  userMessage: string;
  /** True if the caller should auto-retry with a backoff. */
  retryable: boolean;
  /** True if the only recovery is to sign out + sign in again. */
  sessionExpired: boolean;
}

/**
 * Build a structured error payload from Shinami's response. Accepts
 * either an HTTP-level error (4xx/5xx) or a JSON-RPC error body.
 */
export function mapShinamiError(args: {
  httpStatus: number;
  rpcError?: { code: number; message: string };
  context: "wallet" | "prover";
}): ShinamiErrorPayload {
  const { httpStatus, rpcError, context } = args;
  const rawMessage = rpcError?.message ?? `HTTP ${httpStatus}`;

  // HTTP-level errors take precedence — they indicate the call never
  // reached Shinami's RPC layer (network, auth, our proxy issues).
  if (!rpcError) {
    if (httpStatus === 401) {
      return base({
        httpStatus,
        rawMessage,
        userMessage:
          "Wallet service authentication failed. Please contact support.",
      });
    }
    if (httpStatus === 400) {
      return base({
        httpStatus,
        rawMessage,
        userMessage: "We sent a bad request to the wallet service. Please retry.",
      });
    }
    if (httpStatus === 429) {
      return base({
        httpStatus,
        rawMessage,
        retryable: true,
        userMessage: "Wallet service is busy. Please try again in a moment.",
      });
    }
    if (httpStatus >= 500) {
      return base({
        httpStatus,
        rawMessage,
        retryable: true,
        userMessage:
          "Wallet service is having issues. Please try again shortly.",
      });
    }
    return base({
      httpStatus,
      rawMessage,
      userMessage: "Unexpected response from wallet service. Please retry.",
    });
  }

  const { code, message } = rpcError;

  // Per-code mapping. Some -32602 messages are user-actionable (JWT
  // expired, nonce mismatch) and need to flow through the session-
  // expired UX path so the caller signs out + back in.
  switch (code) {
    case -32010:
      return base({
        httpStatus,
        rpcCode: code,
        rawMessage,
        retryable: true,
        userMessage: "Wallet service is rate-limited. Please retry in a moment.",
      });

    case -32012:
      // Two distinct meanings depending on endpoint:
      //   * prover  → 2 proofs / address / minute cap
      //   * wallet  → monthly wallet-creation cap on the project
      return base({
        httpStatus,
        rpcCode: code,
        rawMessage,
        retryable: context === "prover",
        userMessage:
          context === "prover"
            ? "Too many sign attempts in a short window. Please wait about a minute and try again."
            : "We've reached our wallet-creation capacity for the month. Please contact support.",
      });

    case -32602: {
      // Invalid params — sub-categorize by message content.
      if (/issuer .* is not supported/i.test(message)) {
        return base({
          httpStatus,
          rpcCode: code,
          rawMessage,
          userMessage:
            "Your sign-in provider isn't supported. Please use Google to continue.",
        });
      }
      if (/jwt.*expired|token has expired/i.test(message)) {
        return base({
          httpStatus,
          rpcCode: code,
          rawMessage,
          sessionExpired: true,
          userMessage:
            "Your sign-in has expired. Please sign in again to continue.",
        });
      }
      if (/nonce.*does not match/i.test(message)) {
        return base({
          httpStatus,
          rpcCode: code,
          rawMessage,
          sessionExpired: true,
          userMessage:
            "Sign-in session is out of sync. Please sign in again to continue.",
        });
      }
      if (/randomness.*must be 16 bytes|invalid.*randomness/i.test(message)) {
        return base({
          httpStatus,
          rpcCode: code,
          rawMessage,
          sessionExpired: true,
          userMessage:
            "Sign-in session is corrupted. Please sign in again to continue.",
        });
      }
      return base({
        httpStatus,
        rpcCode: code,
        rawMessage,
        userMessage:
          "We sent invalid information to the wallet service. Please retry, or sign in again if this persists.",
      });
    }

    case -32601:
      return base({
        httpStatus,
        rpcCode: code,
        rawMessage,
        userMessage:
          "Wallet service method missing — please contact support (configuration issue).",
      });

    case -32600:
    case -32700:
      return base({
        httpStatus,
        rpcCode: code,
        rawMessage,
        userMessage:
          "We sent a malformed request to the wallet service. Please retry.",
      });

    case -32603:
      return base({
        httpStatus,
        rpcCode: code,
        rawMessage,
        retryable: true,
        userMessage:
          "Wallet service had an internal error. Please retry in a moment.",
      });

    default:
      // -32000…-32099 server errors and anything we haven't enumerated
      // — bias toward retryable since most server-class faults are transient.
      if (code >= -32099 && code <= -32000) {
        return base({
          httpStatus,
          rpcCode: code,
          rawMessage,
          retryable: true,
          userMessage:
            "Wallet service had a transient error. Please retry in a moment.",
        });
      }
      return base({
        httpStatus,
        rpcCode: code,
        rawMessage,
        userMessage: "Wallet service error. Please retry, or contact support.",
      });
  }
}

function base(over: Partial<ShinamiErrorPayload> & { httpStatus: number; rawMessage?: string; userMessage: string }): ShinamiErrorPayload {
  return {
    httpStatus: over.httpStatus,
    rpcCode: over.rpcCode,
    rawMessage: over.rawMessage,
    userMessage: over.userMessage,
    retryable: over.retryable ?? false,
    sessionExpired: over.sessionExpired ?? false,
  };
}
