import { Redirect } from 'expo-router';

// The charge flow now lives on the home tab (index.tsx).
export default function NewPaymentRedirect() {
  return <Redirect href="/(app)" />;
}
