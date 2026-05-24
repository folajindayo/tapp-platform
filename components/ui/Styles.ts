/**
 * Reusable Tailwind class strings — ported from paycrest/zap's
 * `app/components/Styles.ts`. Keep components thin: import these
 * directly rather than re-declaring per-button styling. Edit here to
 * adjust the whole app's visual language.
 */

export const primaryBtnClasses =
  "rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white transition-all hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-white dark:focus-visible:ring-offset-neutral-900 dark:disabled:bg-zinc-800 dark:disabled:text-white/50";

export const secondaryBtnClasses =
  "rounded-xl border border-gray-300 bg-white px-4 py-2.5 font-medium text-neutral-900 transition-all hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-95 dark:border-white/20 dark:bg-neutral-900 dark:text-white dark:hover:bg-white/10 dark:focus-visible:ring-offset-neutral-900";

export const ghostBtnClasses =
  "rounded-xl bg-transparent px-4 py-2.5 font-medium text-neutral-900 transition-all hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 active:scale-95 dark:text-white dark:hover:bg-white/10";

export const dangerBtnClasses =
  "rounded-xl bg-red-600 px-4 py-2.5 font-medium text-white transition-all hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 dark:focus-visible:ring-offset-neutral-900";

export const inputClasses =
  "w-full rounded-xl border border-gray-300 bg-white py-2 px-4 text-sm text-neutral-900 transition-all placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-white/20 dark:bg-neutral-900 dark:text-white/80 dark:placeholder:text-white/30 dark:focus-visible:ring-offset-neutral-900 disabled:cursor-not-allowed";

export const cardClasses =
  "rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-neutral-900";

export const subtleCardClasses =
  "rounded-2xl bg-gray-50 p-5 dark:bg-white/5";
