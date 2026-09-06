"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  PiEyeBold,
  PiEyeSlashBold,
  PiEnvelopeSimpleBold,
  PiLockKeyBold,
  PiUserBold,
  PiArrowLeftBold,
  PiCheckCircleFill,
  PiShieldCheckFill,
  PiSpinnerBold,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import {
  useSession,
  signInWithEmailAndPassword,
  signUpWithEmailAndPassword,
  requestPasswordReset,
  completePasswordReset,
} from "@/lib/auth";
import { InputError } from "@/components/ui/InputError";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";

export default function SignInPage() {
  return (
    <Suspense fallback={<Screen centered />}>
      <SignInBody />
    </Suspense>
  );
}

type AuthMode = "sign-in" | "sign-up" | "forgot-password" | "reset-code";

function SignInBody() {
  const router = useRouter();
  const params = useSearchParams();
  const nextHref = params.get("next") ?? "/";
  const { hydrated, session, login } = useSession();

  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (hydrated && session) {
      router.replace(nextHref);
    }
  }, [hydrated, session, router, nextHref]);

  if (hydrated && session) {
    return null;
  }

  function switchMode(newMode: AuthMode) {
    setError(null);
    setInfoMsg(null);
    setMode(newMode);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);

    // Mode-specific validation and execution
    if (mode === "sign-in") {
      if (!email || !password) {
        setError("Please enter your email and password");
        return;
      }
      setLoading(true);
      try {
        const newSession = await signInWithEmailAndPassword(email, password);
        login(newSession);
        router.replace(nextHref);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Invalid email or password");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === "sign-up") {
      if (!email || !password) {
        setError("Please fill in all required fields");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      setLoading(true);
      try {
        const newSession = await signUpWithEmailAndPassword(
          email,
          password,
          firstName.trim() || "Cardholder",
          "User",
        );
        login(newSession);
        router.replace(nextHref);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Account creation failed");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === "forgot-password") {
      if (!email) {
        setError("Please enter your account email");
        return;
      }
      setLoading(true);
      try {
        const res = await requestPasswordReset(email);
        setInfoMsg(res.message);
        if (res.devOtp) {
          setResetCode(res.devOtp);
        }
        setMode("reset-code");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to send reset code");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === "reset-code") {
      if (!resetCode.trim()) {
        setError("Please enter the 6-digit verification code");
        return;
      }
      if (password.length < 8) {
        setError("New password must be at least 8 characters");
        return;
      }
      if (password !== confirmPassword) {
        setError("New passwords do not match");
        return;
      }
      setLoading(true);
      try {
        await completePasswordReset(email, resetCode.trim(), password);
        setInfoMsg("Password reset successfully! Signing you in…");
        // Automatically sign in with new password
        const newSession = await signInWithEmailAndPassword(email, password);
        login(newSession);
        router.replace(nextHref);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to reset password");
      } finally {
        setLoading(false);
      }
      return;
    }
  }

  const isPasswordValid = password.length >= 8;

  return (
    <Screen centered>
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        {/* Top brand header */}
        <AnimatedComponent variant={slideInOut} className="flex flex-col items-center gap-3">
          <img
            src="/tapp-logo.svg"
            alt="Tapp"
            className="size-14 drop-shadow-sm transition-transform hover:scale-105"
          />

          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">
              {mode === "sign-in" && "Welcome back"}
              {mode === "sign-up" && "Create your account"}
              {mode === "forgot-password" && "Reset your password"}
              {mode === "reset-code" && "Set new password"}
            </h1>
            <p className="text-xs text-gray-500 dark:text-white/60">
              {mode === "sign-in" && "Sign in to access your Tapp wallet"}
              {mode === "sign-up" && "Get your non-custodial Base wallet in seconds"}
              {mode === "forgot-password" && "We'll send a 6-digit verification code to your email"}
              {mode === "reset-code" && `Enter the code sent to ${email}`}
            </p>
          </div>
        </AnimatedComponent>

        {/* Informational banner (e.g. OTP sent) */}
        {infoMsg && (
          <div className="flex w-full items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3 text-left text-xs text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300">
            <PiCheckCircleFill className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <p>{infoMsg}</p>
          </div>
        )}

        <AnimatedComponent variant={slideInOut} delay={0.05} className="w-full">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 text-left">
            {/* Sign Up: First Name */}
            {mode === "sign-up" && (
              <div>
                <label className="block mb-1.5 text-xs font-medium text-gray-700 dark:text-white/80">
                  Full Name
                </label>
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-3.5 text-gray-400 dark:text-white/40">
                    <PiUserBold className="size-4" />
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="Alex Morgan"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-white/70 pl-10 pr-4 py-3 text-sm text-neutral-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-neutral-900/80 dark:text-white dark:placeholder:text-white/30 transition-all"
                  />
                </div>
              </div>
            )}

            {/* Email input (hidden in reset-code mode) */}
            {mode !== "reset-code" && (
              <div>
                <label className="block mb-1.5 text-xs font-medium text-gray-700 dark:text-white/80">
                  Email address
                </label>
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-3.5 text-gray-400 dark:text-white/40">
                    <PiEnvelopeSimpleBold className="size-4" />
                  </span>
                  <input
                    type="email"
                    required
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-white/70 pl-10 pr-4 py-3 text-sm text-neutral-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-neutral-900/80 dark:text-white dark:placeholder:text-white/30 transition-all"
                  />
                </div>
              </div>
            )}

            {/* Reset Code input */}
            {mode === "reset-code" && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-gray-700 dark:text-white/80">
                    6-Digit Verification Code
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleSubmit({ preventDefault: () => {} } as any)}
                    className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Resend code
                  </button>
                </div>
                <input
                  type="text"
                  required
                  maxLength={8}
                  placeholder="123456"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  className="w-full text-center tracking-[0.3em] font-mono rounded-2xl border border-gray-200 bg-white/70 px-4 py-3 text-lg font-semibold text-neutral-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-neutral-900/80 dark:text-white dark:placeholder:text-white/30 transition-all"
                />
              </div>
            )}

            {/* Password input (shown in sign-in, sign-up, reset-code) */}
            {mode !== "forgot-password" && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-gray-700 dark:text-white/80">
                    {mode === "reset-code" ? "New Password" : "Password"}
                  </label>
                  {mode === "sign-in" && (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot-password")}
                      className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400 transition-colors"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>

                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-3.5 text-gray-400 dark:text-white/40">
                    <PiLockKeyBold className="size-4" />
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-white/70 pl-10 pr-11 py-3 text-sm text-neutral-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-neutral-900/80 dark:text-white dark:placeholder:text-white/30 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 text-gray-400 hover:text-neutral-700 dark:hover:text-white transition-colors"
                  >
                    {showPassword ? (
                      <PiEyeSlashBold className="size-4" />
                    ) : (
                      <PiEyeBold className="size-4" />
                    )}
                  </button>
                </div>

                {/* Password strength guide for sign up / reset */}
                {(mode === "sign-up" || mode === "reset-code") && password.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                    <span
                      className={`size-1.5 rounded-full ${
                        isPasswordValid ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                    />
                    <span
                      className={
                        isPasswordValid
                          ? "text-emerald-600 dark:text-emerald-400 font-medium"
                          : "text-amber-600 dark:text-amber-400"
                      }
                    >
                      {isPasswordValid ? "Password meets requirements" : "At least 8 characters required"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Confirm Password (sign-up and reset-code) */}
            {(mode === "sign-up" || mode === "reset-code") && (
              <div>
                <label className="block mb-1.5 text-xs font-medium text-gray-700 dark:text-white/80">
                  Confirm {mode === "reset-code" ? "New Password" : "Password"}
                </label>
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-3.5 text-gray-400 dark:text-white/40">
                    <PiLockKeyBold className="size-4" />
                  </span>
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    minLength={8}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-white/70 pl-10 pr-11 py-3 text-sm text-neutral-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-neutral-900/80 dark:text-white dark:placeholder:text-white/30 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3.5 text-gray-400 hover:text-neutral-700 dark:hover:text-white transition-colors"
                  >
                    {showConfirmPassword ? (
                      <PiEyeSlashBold className="size-4" />
                    ) : (
                      <PiEyeBold className="size-4" />
                    )}
                  </button>
                </div>
                {confirmPassword && password !== confirmPassword && (
                  <p className="mt-1 text-[11px] text-red-500">Passwords do not match</p>
                )}
              </div>
            )}

            {error && <InputError message={error} />}

            {/* Action button */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex w-full items-center justify-center rounded-2xl bg-blue-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? (
                <PiSpinnerBold className="size-5 animate-spin text-white" />
              ) : mode === "sign-in" ? (
                "Sign In"
              ) : mode === "sign-up" ? (
                "Create Account"
              ) : mode === "forgot-password" ? (
                "Send Reset Code"
              ) : (
                "Update Password & Sign In"
              )}
            </button>
          </form>

          {/* Mode switch footer links */}
          <div className="mt-6 flex flex-col items-center gap-3">
            {mode === "sign-in" && (
              <p className="text-xs text-gray-500 dark:text-white/60">
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("sign-up")}
                  className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  Create one
                </button>
              </p>
            )}

            {mode === "sign-up" && (
              <p className="text-xs text-gray-500 dark:text-white/60">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("sign-in")}
                  className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  Sign in
                </button>
              </p>
            )}

            {(mode === "forgot-password" || mode === "reset-code") && (
              <button
                type="button"
                onClick={() => switchMode("sign-in")}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-neutral-900 dark:text-white/60 dark:hover:text-white transition-colors"
              >
                <PiArrowLeftBold className="size-3.5" /> Back to sign in
              </button>
            )}
          </div>

          {/* Security footnote */}
          <div className="mt-8 flex items-center justify-center gap-1.5 text-[11px] text-gray-400 dark:text-white/30">
            <PiShieldCheckFill className="size-3.5 text-blue-500" />
            <span>Base Mainnet · Non-Custodial Encrypted</span>
          </div>
        </AnimatedComponent>
      </div>
    </Screen>
  );
}
