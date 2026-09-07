import { WalletScreen } from "@/components/screens/WalletScreen";

/**
 * The home screen is the wallet. Rendered from the same component as
 * /wallet rather than copied, because the two copies had already drifted.
 */
export default function HomePage() {
  return <WalletScreen />;
}
