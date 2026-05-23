/**
 * Centralized query key factory.
 *
 * All keys are `as const` tuples so TypeScript narrows them correctly for
 * invalidateQueries / prefetchQuery / removeQueries calls.
 *
 * Usage:
 *   useQuery({ queryKey: queryKeys.auth.me(), queryFn: authApi.me })
 *   queryClient.invalidateQueries({ queryKey: queryKeys.orders.lists() })
 */
export const queryKeys = {
  auth: {
    me: () => ['auth', 'me'] as const,
  },

  settings: {
    sender: () => ['settings', 'sender'] as const,
  },

  kyc: {
    status: (userId: string) => ['kyc', 'status', userId] as const,
  },

  catalog: {
    institutions: (currency: string) => ['catalog', 'institutions', currency] as const,
    rates: (token: string, amount: string, fiat: string) =>
      ['catalog', 'rates', token, amount, fiat] as const,
  },

  verify: {
    account: (institution: string, accountNumber: string) =>
      ['verify', 'account', institution, accountNumber] as const,
  },

  merchant: {
    bankAccount: () => ['merchant', 'bank-account'] as const,
  },

  orders: {
    // Partial key — used to invalidate all order lists at once.
    lists: () => ['sender', 'orders'] as const,
    list: (filter: string | undefined) => ['sender', 'orders', 'all', filter ?? 'any'] as const,
    recent: () => ['sender', 'orders', 'recent'] as const,
    detail: (id: string) => ['sender', 'orders', id] as const,
    stats: () => ['sender', 'stats'] as const,
  },
} as const;
