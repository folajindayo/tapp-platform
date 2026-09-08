"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PiBankBold,
  PiCopyBold,
  PiCheckBold,
  PiShareNetworkBold,
  PiWarningOctagonFill,
  PiShieldCheckBold,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { Surface } from "@/components/ui/Surface";
import { inputClasses } from "@/components/ui/Styles";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { useBalances, balanceIn, useKycStatus, useNGNAccount } from "@/lib/ledger";
import { ApiError, kycApi, ngnDepositsApi, type KycResult } from "@/lib/api";

/**
 * Getting paid in naira.
 *
 * One account number, issued by the bank behind the rail, permanent and
 * theirs. Somebody transfers to it from any Nigerian bank and it becomes naira
 * in their balance -- the same shape as the USDC address screen, which is the
 * point: "where do I send it" has one kind of answer.
 *
 * Two things stand between a new account and that number, and they are shown
 * as two steps rather than one long form. The BVN check is quick, cheap and
 * unlocks limits on its own; opening the account needs a NIN and an address on
 * top and is the heavier ask. Collapsing them would mean somebody who only
 * wanted higher limits has to find their NIN, and somebody who abandons the
 * long form loses the verification they had already passed.
 */
export default function NairaDepositPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const account = useNGNAccount();
  const kyc = useKycStatus();

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/deposit/naira");
  }, [hydrated, session, router]);

  // The BVN is asked for once and carried between the steps. Held only in this
  // component: it is a national identifier, and nothing here writes it to
  // storage the browser keeps after the tab closes.
  const [bvn, setBvn] = useState("");

  if (!hydrated || !session) return <Screen />;

  const loading = account.isLoading || kyc.isLoading;
  const verified = (kyc.data?.tier ?? 0) >= 1;

  return (
    <Screen>
      <AnimatedComponent variant={slideInOut} className="grid gap-6 py-8">
        <header className="grid gap-1">
          <h1 className="text-xl font-medium text-[var(--fg)]">Receive naira</h1>
          <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
            {account.data
              ? "Transfer to this account from any Nigerian bank. It becomes naira in your balance when the transfer lands."
              : "Your own account number at a Nigerian bank. Anyone can pay into it, and the money lands in your balance."}
          </p>
        </header>

        {loading ? (
          <Surface kind="sunken" radius="3xl" className="grid place-items-center py-16">
            <div className="loader" />
          </Surface>
        ) : account.error ? (
          <LoadFailure error={account.error} />
        ) : account.data ? (
          <AccountView account={account.data} />
        ) : !verified ? (
          <VerifyStep bvn={bvn} onBvn={setBvn} />
        ) : (
          <OpenStep bvn={bvn} onBvn={setBvn} />
        )}
      </AnimatedComponent>
    </Screen>
  );
}

// -----------------------------------------------------------------------------
// The account, once it exists
// -----------------------------------------------------------------------------

function AccountView({
  account,
}: {
  account: NonNullable<ReturnType<typeof useNGNAccount>["data"]>;
}) {
  const balances = useBalances();
  const ngn = balanceIn(balances.data, "NGN");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(account.account_number);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the number is on screen to read.
    }
  }

  async function share() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: "My naira account",
          text: `${account.account_number} · ${account.bank_name} · ${account.account_name}`,
        });
      } catch {
        // The user dismissed the sheet.
      }
    }
  }

  return (
    <>
      {account.warning ? (
        <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
          <p className="text-xs leading-relaxed">{account.warning}</p>
        </InfoBanner>
      ) : null}

      <Surface radius="3xl" className="grid gap-4">
        <div className="grid justify-items-center gap-1 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--sunken)] text-xl text-[var(--fg-muted)]">
            <PiBankBold />
          </span>
          {/* The number is the largest thing on the screen because it is the
              one thing somebody came here to read off and type somewhere
              else. Spaced in fours: a ten-digit run is easy to mis-copy. */}
          <p className="mt-2 font-mono text-3xl font-medium tracking-wider tabular-nums text-[var(--fg)]">
            {account.account_number.replace(/(\d{4})(?=\d)/g, "$1 ")}
          </p>
          <p className="text-sm text-[var(--fg-muted)]">{account.bank_name}</p>
          <p className="text-xs text-[var(--fg-subtle)]">{account.account_name}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={copy}
            leadingIcon={copied ? <PiCheckBold /> : <PiCopyBold />}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="secondary" onClick={share} leadingIcon={<PiShareNetworkBold />}>
            Share
          </Button>
        </div>
      </Surface>

      <Surface kind="sunken" padding="md" radius="2xl" className="grid gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
          Your naira
        </p>
        <p className="text-2xl font-medium tabular-nums text-[var(--fg)]">
          {ngn?.available.display ?? "—"}
        </p>
        <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
          This updates by itself when a transfer lands. You can leave this page.
        </p>
      </Surface>
    </>
  );
}

// -----------------------------------------------------------------------------
// Step one: the BVN
// -----------------------------------------------------------------------------

function VerifyStep({ bvn, onBvn }: { bvn: string; onBvn: (v: string) => void }) {
  const { session } = useSession();
  const qc = useQueryClient();
  const kyc = useKycStatus();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // What the check actually said, when it said no. A rejection is not an
  // error: a misspelt surname is something the person can fix in ten seconds,
  // and showing it as "something went wrong" wastes that.
  const [refused, setRefused] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: () =>
      kycApi.verifyBvn(
        {
          bvn: bvn.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        },
        session!.jwt,
      ),
    onSuccess: (result: KycResult) => {
      if (result.status === "approved") {
        setRefused(null);
        void qc.invalidateQueries({ queryKey: ["kyc", "status"] });
        return;
      }
      setRefused(
        result.reason ||
          "That did not match the details held against this BVN. Check the spelling and try again.",
      );
    },
  });

  const ready = /^\d{11}$/.test(bvn.trim()) && !!firstName.trim() && !!lastName.trim();
  const unlocks = kyc.data?.next?.unlocks;

  return (
    <>
      <InfoBanner icon={<PiShieldCheckBold className="text-[var(--accent)]" />}>
        <p className="font-medium text-[var(--fg)]">Verify your BVN first</p>
        <p className="mt-1 text-xs leading-relaxed">
          A bank account has to be in somebody&apos;s name, and this is how we
          establish it is yours.
          {unlocks
            ? ` It also raises what you can hold to ${unlocks.max_balance.display} and what you can move in a day to ${unlocks.daily.display}.`
            : ""}
        </p>
      </InfoBanner>

      <div className="grid gap-3">
        <Field
          id="bvn"
          label="BVN"
          value={bvn}
          onChange={onBvn}
          inputMode="numeric"
          maxLength={11}
          placeholder="11 digits"
          hint="Dial *565*0# from the number your bank has, if you don't know it."
        />
        <div className="grid grid-cols-2 gap-3">
          <Field id="firstName" label="First name" value={firstName} onChange={setFirstName} />
          <Field id="lastName" label="Surname" value={lastName} onChange={setLastName} />
        </div>
        <p className="px-1 text-xs leading-relaxed text-[var(--fg-muted)]">
          Spell them the way your bank has them. We compare what you type to the
          record behind this BVN, and a mismatch is what stops somebody using a
          number that is not theirs.
        </p>
      </div>

      {refused ? (
        <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
          <p className="text-xs leading-relaxed">{refused}</p>
        </InfoBanner>
      ) : null}
      {verify.error ? <RequestFailure error={verify.error} /> : null}

      <Button disabled={!ready} loading={verify.isPending} onClick={() => verify.mutate()}>
        Verify
      </Button>
    </>
  );
}

// -----------------------------------------------------------------------------
// Step two: open the account
// -----------------------------------------------------------------------------

function OpenStep({ bvn, onBvn }: { bvn: string; onBvn: (v: string) => void }) {
  const { session } = useSession();
  const qc = useQueryClient();
  const kyc = useKycStatus();

  const [nin, setNin] = useState("");
  const [address, setAddress] = useState("");

  const open = useMutation({
    mutationFn: () =>
      ngnDepositsApi.open(
        { bvn: bvn.trim(), nin: nin.trim(), address: address.trim() },
        session!.jwt,
      ),
    onSuccess: (opened) => {
      // Written straight into the cache rather than invalidated: the account
      // was just created and this response IS the newest truth about it. A
      // refetch would only add a moment where the screen shows the step that
      // opens an account that already exists.
      qc.setQueryData(["deposits", "ngn", session?.email ?? ""], opened);
    },
  });

  const ready = /^\d{11}$/.test(bvn.trim()) && !!nin.trim() && !!address.trim();
  const name = kyc.data?.identity;

  return (
    <>
      <InfoBanner icon={<PiBankBold className="text-[var(--accent)]" />}>
        <p className="font-medium text-[var(--fg)]">
          {name?.firstName ? `Almost there, ${name.firstName}` : "Two more details"}
        </p>
        <p className="mt-1 text-xs leading-relaxed">
          The bank opens the account in your name, and it will not do that
          without your NIN and an address. That is its requirement, not ours.
          Neither is kept here once the account exists.
        </p>
      </InfoBanner>

      <div className="grid gap-3">
        <Field
          id="bvn"
          label="BVN"
          value={bvn}
          onChange={onBvn}
          inputMode="numeric"
          maxLength={11}
          placeholder="11 digits"
        />
        <Field
          id="nin"
          label="NIN"
          value={nin}
          onChange={setNin}
          inputMode="numeric"
          placeholder="National Identification Number"
        />
        <Field
          id="address"
          label="Address"
          value={address}
          onChange={setAddress}
          placeholder="Where you live"
        />
      </div>

      {open.error ? <RequestFailure error={open.error} /> : null}

      <Button disabled={!ready} loading={open.isPending} onClick={() => open.mutate()}>
        Open my naira account
      </Button>
    </>
  );
}

// -----------------------------------------------------------------------------
// Shared bits
// -----------------------------------------------------------------------------

function Field({
  id,
  label,
  value,
  onChange,
  hint,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange">) {
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={id}
        className="px-1 text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]"
      >
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClasses}
        {...rest}
      />
      {hint ? <p className="px-1 text-xs text-[var(--fg-muted)]">{hint}</p> : null}
    </div>
  );
}

function LoadFailure({ error }: { error: unknown }) {
  return (
    <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
      <p className="font-medium text-[var(--fg)]">Couldn&apos;t load your account</p>
      <p className="mt-1 text-xs leading-relaxed">
        {message(error)} Don&apos;t use an account number from anywhere else —
        it will not be yours, and money sent to it does not come back.
      </p>
    </InfoBanner>
  );
}

function RequestFailure({ error }: { error: unknown }) {
  return (
    <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
      <p className="text-xs leading-relaxed">{message(error)}</p>
    </InfoBanner>
  );
}

/**
 * The server's own words where there are any.
 *
 * `missing` is spelled out when the rail refused for want of a field, because
 * "more details are needed" is not something anybody can act on and "we still
 * need your NIN" is.
 */
function message(error: unknown): string {
  if (error instanceof ApiError) {
    const missing = (error.data as { missing?: string[] } | undefined)?.missing;
    if (missing?.length) {
      return `We still need: ${missing.join(", ")}.`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Try again in a moment.";
}
