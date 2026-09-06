"use client";

import Link from "next/link";
import { useState, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PiCheckBold } from "react-icons/pi";

const Button = ({
  onClick,
  className,
  children,
}: {
  onClick: () => void;
  className: string;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-xl px-4 py-2.5 text-center text-sm font-medium transition-all active:scale-95 ${className}`}
  >
    {children}
  </button>
);

export function CookieConsent() {
  const [isBannerVisible, setIsBannerVisible] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [consent, setConsent] = useState({
    marketing: false,
    analytics: false,
    essential: true,
  });

  useEffect(() => {
    const cookieConsent = localStorage.getItem("cookieConsent");
    if (!cookieConsent) {
      setIsBannerVisible(true);
    }
  }, []);

  const handleCustomize = () => {
    setIsBannerVisible(false);
    setIsModalOpen(true);
  };

  const handleAcceptAll = () => {
    const consentData = { marketing: true, analytics: true, essential: true };
    setConsent(consentData);
    localStorage.setItem("cookieConsent", JSON.stringify(consentData));
    setIsBannerVisible(false);
  };

  const handleRejectNonEssential = () => {
    const consentData = { marketing: false, analytics: false, essential: true };
    setConsent(consentData);
    localStorage.setItem("cookieConsent", JSON.stringify(consentData));
    setIsBannerVisible(false);
    setIsModalOpen(false);
  };

  const handleAcceptSelected = () => {
    localStorage.setItem("cookieConsent", JSON.stringify(consent));
    setIsModalOpen(false);
  };

  const toggleOption = (key: "marketing" | "analytics") => {
    setConsent((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const CheckboxField = ({
    label,
    description,
    checked,
    onChange,
    disabled = false,
  }: {
    label: string;
    description: string;
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
  }) => (
    <div className="flex items-start justify-between gap-4 mt-2">
      <div className="text-xs text-neutral-600 dark:text-white/60">
        <span className="font-semibold text-neutral-800 dark:text-white">{label}</span>
        <span>: {description}</span>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onChange}
        className={`flex size-5 flex-shrink-0 cursor-pointer items-center justify-center rounded border-2 transition-all ${
          checked
            ? "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500"
            : "border-gray-300 bg-gray-50 dark:border-white/20 dark:bg-transparent"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        {checked && <PiCheckBold size={12} />}
      </button>
    </div>
  );

  return (
    <>
      <AnimatePresence>
        {isBannerVisible && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { delay: 1, duration: 0.3 },
            }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-5 right-5 z-[140] w-[calc(100vw-40px)] max-w-[25.75rem] space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-lg dark:border-white/5 dark:bg-neutral-800"
          >
            <div className="space-y-2 text-neutral-900 dark:text-white">
              <h2 className="text-lg font-semibold">We use cookies</h2>
              <p className="text-xs text-neutral-600 dark:text-white/70 leading-relaxed">
                Our website utilizes cookies to enhance your experience.{" "}
                <Link
                  href="/privacy"
                  className="text-blue-600 no-underline hover:underline dark:text-blue-400"
                >
                  Learn more
                </Link>
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                onClick={handleCustomize}
                className="flex-1 min-w-[80px] bg-gray-100 text-neutral-800 hover:bg-gray-250 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
              >
                Customize
              </Button>
              <Button
                onClick={handleRejectNonEssential}
                className="flex-1 min-w-[80px] bg-gray-100 text-neutral-800 hover:bg-gray-250 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
              >
                Reject all
              </Button>
              <Button
                onClick={handleAcceptAll}
                className="flex-[2] min-w-[120px] bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                Accept all
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[145] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            />

            {/* Panel */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-[25.75rem] space-y-4 rounded-3xl bg-white p-6 shadow-xl dark:bg-neutral-800 z-10"
            >
              <div className="space-y-2 text-neutral-900 dark:text-white">
                <h2 className="text-lg font-semibold">Cookie Settings</h2>
                <p className="text-xs text-neutral-600 dark:text-white/70 leading-relaxed">
                  Our website utilizes cookies to enhance your experience.{" "}
                  <Link
                    href="/privacy"
                    className="text-blue-600 no-underline hover:underline dark:text-blue-400"
                  >
                    Learn more
                  </Link>
                </p>
              </div>

              <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-white/5 dark:bg-white/5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Select preferences
                </h3>

                <CheckboxField
                  label="Marketing"
                  description="Used to deliver relevant ads and track engagement."
                  checked={consent.marketing}
                  onChange={() => toggleOption("marketing")}
                />
                <CheckboxField
                  label="Analytics"
                  description="Helps us understand how users interact with the app."
                  checked={consent.analytics}
                  onChange={() => toggleOption("analytics")}
                />
                <CheckboxField
                  label="Essential"
                  description="Required for basic app functionality and session auth."
                  checked={consent.essential}
                  onChange={() => {}}
                  disabled
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleRejectNonEssential}
                  className="flex-1 bg-gray-105 text-neutral-800 hover:bg-gray-200 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                >
                  Reject all
                </Button>
                <Button
                  onClick={handleAcceptSelected}
                  className="flex-1 bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  Save settings
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
