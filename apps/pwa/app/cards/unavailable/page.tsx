import { Suspense } from "react";
import Link from "next/link";
import { PiSealQuestionBold } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";

export default function CardsUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  return (
    <Suspense fallback={<Screen />}>
      <Body searchParamsPromise={searchParams} />
    </Suspense>
  );
}

async function Body({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ status?: string }>;
}) {
  const { status } = await searchParamsPromise;
  const copy = messageFor(status);
  return (
    <Screen centered>
      <div className="flex flex-col items-center gap-8 text-center">
        <PiSealQuestionBold className="text-5xl text-gray-400 dark:text-white/40" />
        <div className="space-y-3">
          <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
            {copy.title}
          </h1>
          <p className="max-w-xs text-sm text-gray-500 dark:text-white/50">
            {copy.body}
          </p>
        </div>
        <Link href="/" className="w-full">
          <Button variant="secondary">Go to wallet</Button>
        </Link>
      </div>
    </Screen>
  );
}

function messageFor(status: string | undefined) {
  switch (status) {
    case "revoked":
      return {
        title: "Card revoked",
        body:
          "This card was revoked by its owner and can no longer be used. Talk to support if you think this is a mistake.",
      };
    case "locked":
      return {
        title: "Card locked",
        body:
          "Too many failed PIN attempts. The card is locked for 24 hours. Contact support if you need it sooner.",
      };
    default:
      return {
        title: "Card unavailable",
        body: "This card can't be used right now. Contact support for help.",
      };
  }
}
