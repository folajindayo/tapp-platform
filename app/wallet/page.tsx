import { redirect } from "next/navigation";

// Redirect `/wallet` to root `/` which is now the primary surface.
export default function WalletRedirect() {
  redirect("/");
}
