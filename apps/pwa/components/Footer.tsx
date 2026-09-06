"use client";

import { usePathname } from "next/navigation";
import { FiGithub, FiTwitter, FiMail } from "react-icons/fi";
import { useSession } from "@/lib/auth";
import { shouldShowBottomNav } from "./BottomNav";

/**
 * Footer — dashed top border, attribution row on the left, social
 * cluster on the right. Hidden on signed-in pages where the bottom
 * tab nav is shown (no need for double bottom chrome).
 */
export function Footer() {
  const pathname = usePathname() ?? "";
  const { hydrated, session } = useSession();
  const navVisible = hydrated && !!session && shouldShowBottomNav(pathname);
  if (navVisible) return null;

  const year = new Date().getFullYear();
  return (
    <footer className="mt-8 flex w-full items-center justify-between border-t border-dashed border-gray-200 pb-6 pt-4 text-xs font-medium dark:border-white/10">
      <p className="text-gray-500 dark:text-white/50">
        © {year} Zoracle ·{" "}
        <a
          href="https://sui.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neutral-900 hover:underline dark:text-white/80"
        >
          Powered by Sui
        </a>
      </p>
      <div className="flex items-center gap-4">
        <a
          href="https://twitter.com/usezoracle"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="X / Twitter"
          className="text-gray-500 transition-opacity hover:opacity-70 dark:text-white/50"
        >
          <FiTwitter className="size-4" />
        </a>
        <a
          href="https://github.com/usezoracle"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          className="text-gray-500 transition-opacity hover:opacity-70 dark:text-white/50"
        >
          <FiGithub className="size-4" />
        </a>
        <a
          href="mailto:labs@zoracle.xyz"
          aria-label="Email support"
          className="text-gray-500 transition-opacity hover:opacity-70 dark:text-white/50"
        >
          <FiMail className="size-4" />
        </a>
      </div>
    </footer>
  );
}
