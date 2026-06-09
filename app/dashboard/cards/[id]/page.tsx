import { redirect } from "next/navigation";

/**
 * The rails `GET /c/:token` handler redirects a tapped card that is already
 * `claimed`/`live` to `<PWA>/dashboard/cards/:id`. The PWA models a single
 * card per user (`GET /v1/cards/me`) and has no by-id view, so this route is
 * a thin alias onto the real card page instead of a 404.
 *
 * The `[id]` segment is intentionally ignored — `/settings/card` resolves the
 * signed-in user's card itself (and bounces to /sign-in if there's no session).
 */
export default function CardByIdPage() {
  redirect("/settings/card");
}
