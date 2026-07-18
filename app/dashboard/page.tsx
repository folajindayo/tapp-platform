import { redirect } from "next/navigation";

// `/dashboard` was the old primary surface. New primary is `/`.
// Permanent redirect (308) keeps any bookmarks/external links working.
export default function DashboardRedirect() {
  redirect("/");
}
