"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Screen } from "@/components/ui/Screen";
import {
  GoogleSignInButton,
  takeNextHref,
} from "@/components/GoogleSignInButton";
import {
  useSession,
  signInWithEmailAndPassword,
  signUpWithEmailAndPassword,
} from "@/lib/auth";
import { InputError } from "@/components/ui/InputError";
import {
  AnimatedComponent,
  slideInOut,
  fadeInOut,
} from "@/components/ui/AnimatedComponents";
import { parseGoogleAuthFragment } from "@/lib/google-oauth";

export default function SignInPage() {
  return (
    <Suspense fallback={<Screen centered />}>
      <SignInBody />
    </Suspense>
  );
}

function SignInBody() {
  const router = useRouter();
  const params = useSearchParams();
  const nextHref = params.get("next") ?? "/";
  const { hydrated, session, login } = useSession();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (hydrated && session) {
    router.replace(nextHref);
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }
    setLoading(true);
    try {
      let newSession;
      if (isSignUp) {
        newSession = await signUpWithEmailAndPassword(
          email,
          password,
          firstName || "Cardholder",
          "User",
        );
      } else {
        newSession = await signInWithEmailAndPassword(email, password);
      }
      login(newSession);
      router.replace(nextHref);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen centered>
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <AnimatedComponent variant={slideInOut}>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-white">
            Tapp Card
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-white/50">
            {isSignUp ? "Create your Tapp account" : "Sign in to your wallet"}
          </p>
        </AnimatedComponent>

        {/* Tab switch */}
        <div className="grid w-full grid-cols-2 p-1 bg-gray-100 dark:bg-white/5 rounded-2xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setIsSignUp(false);
              setError(null);
            }}
            className={`py-2 rounded-xl transition-all ${
              !isSignUp
                ? "bg-white text-neutral-900 shadow-sm dark:bg-white/15 dark:text-white"
                : "text-gray-500 dark:text-white/40"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setIsSignUp(true);
              setError(null);
            }}
            className={`py-2 rounded-xl transition-all ${
              isSignUp
                ? "bg-white text-neutral-900 shadow-sm dark:bg-white/15 dark:text-white"
                : "text-gray-500 dark:text-white/40"
            }`}
          >
            Create Account
          </button>
        </div>

        <AnimatedComponent variant={slideInOut} delay={0.1} className="w-full">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-left">
            {isSignUp && (
              <div>
                <label className="block mb-1 text-xs font-medium text-gray-600 dark:text-white/70">
                  Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="Jane Doe"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 bg-transparent px-4 py-3 text-sm text-neutral-900 dark:border-white/10 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            <div>
              <label className="block mb-1 text-xs font-medium text-gray-600 dark:text-white/70">
                Email
              </label>
              <input
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-2xl border border-gray-200 bg-transparent px-4 py-3 text-sm text-neutral-900 dark:border-white/10 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block mb-1 text-xs font-medium text-gray-600 dark:text-white/70">
                Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-2xl border border-gray-200 bg-transparent px-4 py-3 text-sm text-neutral-900 dark:border-white/10 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && <InputError message={error} />}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-2xl bg-blue-600 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-700 disabled:opacity-50"
            >
              {loading
                ? isSignUp
                  ? "Creating Account…"
                  : "Signing In…"
                : isSignUp
                ? "Create Account"
                : "Sign In"}
            </button>
          </form>

          <p className="pt-4 text-center text-[10px] text-gray-400 dark:text-white/30">
            Base Mainnet Powered · Non-Custodial Encrypted
          </p>
        </AnimatedComponent>
      </div>
    </Screen>
  );
}
