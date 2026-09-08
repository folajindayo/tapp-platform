"use client";

/**
 * Identity verification, from settings.
 *
 * A ladder, not a gate: where somebody stands, what that lets them move, and
 * the one step still open to them. The BVN check and the photograph are the
 * same checks the deposit screen asks for when an amount needs them; here they
 * can be done ahead of time.
 *
 * The photograph is captured on the device with the front camera and sent as
 * one frame. Liveness is a property of how an image was captured, which is
 * why the capture happens here and not in a file picker.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PiArrowLeftBold,
  PiCameraBold,
  PiCheckCircleFill,
  PiIdentificationCardBold,
  PiWarningOctagonFill,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { KycTierChip } from "@/components/ui/KycTierChip";
import { RequestFailure } from "@/components/ui/RequestFailure";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { useKycStatus } from "@/lib/ledger";
import { ApiError, kycApi, type KycLimits, type KycResult, type KycStatus } from "@/lib/api";

export default function SettingsKycPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const kyc = useKycStatus();

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/settings/kyc");
  }, [hydrated, session, router]);

  if (!hydrated || !session) return <Screen />;

  return (
    <Screen>
      <AnimatedComponent
        variant={slideInOut}
        className="grid gap-6 py-10 text-sm text-neutral-900 dark:text-white"
      >
        <Link
          href="/settings"
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-gray-500 transition-colors hover:text-neutral-900 dark:text-white/50 dark:hover:text-white"
        >
          <PiArrowLeftBold /> Back to settings
        </Link>

        <div className="space-y-2">
          <h1 className="text-xl font-medium">Identity verification</h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            Each step raises what you can hold and move. Nothing is asked for
            until you need it.
          </p>
        </div>

        {kyc.isLoading ? (
          <p className="text-xs text-gray-500 dark:text-white/50">Loading your status…</p>
        ) : kyc.isError ? (
          <Unavailable error={kyc.error} />
        ) : kyc.data ? (
          <>
            <StatusCard status={kyc.data} />
            <NextStep status={kyc.data} />
          </>
        ) : null}
      </AnimatedComponent>
    </Screen>
  );
}

// -----------------------------------------------------------------------------
// Where somebody stands
// -----------------------------------------------------------------------------

function StatusCard({ status }: { status: KycStatus }) {
  const who = status.identity;
  return (
    <div className="grid gap-4 rounded-3xl border border-gray-200 p-4 dark:border-white/10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-white/60">
            <PiIdentificationCardBold />
          </span>
          <div className="grid gap-0.5">
            <p className="font-medium">Status</p>
            <p className="text-xs text-gray-500 dark:text-white/50">
              {who
                ? `${who.firstName} ${who.lastName}${who.bvnLast4 ? ` · BVN ending ${who.bvnLast4}` : ""}`
                : "No identity on file yet"}
            </p>
          </div>
        </div>
        <KycTierChip status={status} />
      </div>
      <Limits label="What you can do now" limits={status.limits} />
    </div>
  );
}

function Limits({ label, limits }: { label: string; limits: KycLimits }) {
  const rows: Array<[string, string]> = [
    ["Per payment", limits.per_transaction.display],
    ["Per day", limits.daily.display],
    ["Per month", limits.monthly.display],
    ["Balance", limits.max_balance.display],
  ];
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/30">
        {label}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-dashed border-gray-100 py-1 dark:border-white/5">
            <dt className="text-gray-500 dark:text-white/50">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// -----------------------------------------------------------------------------
// The one step still open
// -----------------------------------------------------------------------------

function NextStep({ status }: { status: KycStatus }) {
  const next = status.next;
  if (!next) {
    return (
      <InfoBanner icon={<PiCheckCircleFill className="text-green-600" />}>
        <p className="font-medium text-[var(--fg)]">You&apos;re fully verified</p>
        <p className="mt-1 text-xs leading-relaxed">There is nothing more to do here.</p>
      </InfoBanner>
    );
  }
  return (
    <div className="grid gap-4 rounded-3xl border border-gray-200 p-4 dark:border-white/10">
      <div className="grid gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/30">
          Next step
        </p>
        <p className="font-medium">{next.tier_name}</p>
      </div>
      <Limits label="What it unlocks" limits={next.unlocks} />
      {next.tier === 1 ? <BvnStep /> : <SelfieStep />}
    </div>
  );
}

/** Step one: the BVN, matched to the name the bank holds against it. */
function BvnStep() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [bvn, setBvn] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [refused, setRefused] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: () =>
      kycApi.verifyBvn(
        {
          bvn: bvn.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          ...(dateOfBirth.trim() ? { dateOfBirth: dateOfBirth.trim() } : {}),
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

  return (
    <>
      <div className="grid gap-3">
        <Field
          id="bvn"
          label="BVN"
          value={bvn}
          onChange={setBvn}
          inputMode="numeric"
          maxLength={11}
          placeholder="11 digits"
          hint="Dial *565*0# from the number your bank has, if you don't know it."
        />
        <div className="grid grid-cols-2 gap-3">
          <Field id="firstName" label="First name" value={firstName} onChange={setFirstName} />
          <Field id="lastName" label="Surname" value={lastName} onChange={setLastName} />
        </div>
        <Field
          id="dateOfBirth"
          label="Date of birth (optional)"
          value={dateOfBirth}
          onChange={setDateOfBirth}
          type="date"
          hint="Checked against the record when given."
        />
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
        Verify BVN
      </Button>
    </>
  );
}

/** Step two: a photograph, matched to the one the bank holds behind the BVN. */
function SelfieStep() {
  const { session } = useSession();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [bvn, setBvn] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: () =>
      kycApi.verifySelfie({ bvn: bvn.trim(), image: stripDataUrl(preview!) }, session!.jwt),
    onSuccess: (result: KycResult) => {
      if (result.status === "approved") {
        setRefused(null);
        void qc.invalidateQueries({ queryKey: ["kyc", "status"] });
        return;
      }
      setRefused(
        result.reason ||
          "That photograph did not match the one held against this BVN. Try again in good light, facing the camera.",
      );
    },
  });

  function onCapture(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  const ready = /^\d{11}$/.test(bvn.trim()) && !!preview;

  return (
    <>
      <Field
        id="bvn"
        label="BVN"
        value={bvn}
        onChange={setBvn}
        inputMode="numeric"
        maxLength={11}
        placeholder="The BVN you verified"
        hint="Your BVN is not stored; enter it again so the photograph is matched to the right record."
      />
      {/* capture="user" asks the device for the front camera, not a file picker. */}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => onCapture(e.target.files?.[0])}
      />
      {preview ? (
        <div className="grid gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL, not a remote asset */}
          <img
            src={preview}
            alt="Your photograph"
            className="mx-auto aspect-square w-40 rounded-3xl object-cover"
          />
          <Button variant="secondary" onClick={() => input.current?.click()}>
            Retake
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => input.current?.click()}>
          <PiCameraBold /> Take a photo
        </Button>
      )}
      <p className="px-1 text-xs leading-relaxed text-[var(--fg-muted)]">
        Face the camera in good light, with nothing covering your face. One
        photograph is taken on this device and compared to the bank&apos;s record.
      </p>
      {refused ? (
        <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
          <p className="text-xs leading-relaxed">{refused}</p>
        </InfoBanner>
      ) : null}
      {verify.error ? <RequestFailure error={verify.error} /> : null}
      <Button disabled={!ready} loading={verify.isPending} onClick={() => verify.mutate()}>
        Verify photo
      </Button>
    </>
  );
}

/** The API takes the base64 frame alone, without the data-URL prefix. */
function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

// -----------------------------------------------------------------------------
// When there is no status to show
// -----------------------------------------------------------------------------

function Unavailable({ error }: { error: unknown }) {
  // The routes exist only once the API has an identity provider configured.
  const notOffered = error instanceof ApiError && error.status === 404;
  return (
    <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
      <p className="font-medium text-[var(--fg)]">
        {notOffered ? "Verification isn't available yet" : "Couldn't load your status"}
      </p>
      <p className="mt-1 text-xs leading-relaxed">
        {notOffered
          ? "This deployment has no identity provider configured. Your balance and payments are unaffected."
          : <RequestFailureText error={error} />}
      </p>
    </InfoBanner>
  );
}

function RequestFailureText({ error }: { error: unknown }) {
  return <>{error instanceof Error ? error.message : "Try again in a moment."}</>;
}
