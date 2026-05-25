import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiBaseUrl?: string;
  checkoutBaseUrl?: string;
};

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  extra.apiBaseUrl ??
  "http://localhost:8000";

export const CHECKOUT_BASE_URL =
  process.env.EXPO_PUBLIC_CHECKOUT_BASE_URL ??
  extra.checkoutBaseUrl ??
  "https://checkout.zoracle.xyz";
