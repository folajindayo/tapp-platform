# Tapp — Motion & interaction guidelines

> Every action must give a reaction.

This is the Tapp-specific version of `users-app/docs/MOTION_PRINCIPLES.md`,
translated into our stack (Next.js App Router + Framer Motion + Tailwind v4
+ web touch / pointer / vibration APIs). The source doc is the long-form
treatment; this one is the working contract for the codebase.

The thesis: **a finance PWA is dense, abstract, and occasionally scary.
Motion is how we acknowledge each tap inside the same frame, narrate state
changes, and tell the user where the result of their action lives.** Motion
that doesn't pull its weight is a tax on perceived performance — cut it.
Motion that earns its keep is the difference between an app that *feels*
trusted and one that doesn't.

## 1. The hierarchy

Every animation must fit one of four tiers. If it doesn't, delete it.

1. **Architectural** — communicates *where you are*. Sheet rises from
   below; back navigation flashes right; bottom-nav active pill slides.
   Must be present, must be subtle.
2. **Causal** — direct response to a touch. Press scale, drag-follow,
   spinner mount. Must start in the same frame as the touch.
3. **Status** — value changed, success/error/pending, async result.
   Must *morph*, not swap.
4. **Delight** — rare moments worth marking (first deposit, first card
   activation, first successful tap-pay). Sparingly; budget by frequency.

Two filters before merge:

- **Purpose.** If removing the animation doesn't lose information, lose it.
- **Cohesion.** Reach for shared constants in `lib/motion.ts`. New curves
  or durations should be named and documented.

## 2. Tokens — `lib/motion.ts`

Single source of truth. Don't sprinkle magic numbers in components.

```ts
DURATIONS = {
  fast:   0.16,  // press feedback, opacity flips
  normal: 0.24,  // page transitions, sheet/modal entries
  slow:   0.36,  // multi-step rail panes
  countUp: 1.0,  // balance / amount mount roll-up
}

CURVES = {
  easeOut: [0.32, 0.72, 0, 1],   // the Family/Kowalski curve — default for everything user-triggered
  inOut:   [0.65, 0, 0.35, 1],   // auto-advancing carousels, things that loop
}

SPRINGS = {
  default: { mass: 0.6, damping: 18, stiffness: 220 },  // sheets, drawers, "feel"
  tight:   { mass: 0.4, damping: 22, stiffness: 320 },  // buttons, micro-press
  soft:    { mass: 0.8, damping: 14, stiffness: 140 },  // drags, gestures
}
```

`PAGE_VARIANTS` (the entry/exit for an `AnimatedPage`) uses
`{ opacity, y: 12 → 0 → -12 }` with `easeOut`, **180–240ms total**. Keep page
swaps under the 300ms rule — anything longer feels sluggish.

## 3. Hard rules (the Kowalski seven)

1. **Default duration < 300ms** for routine user-triggered transitions.
2. **`easeOut` curve** for things the user just triggered (fast start,
   soft land). Reach for `CURVES.easeOut`.
3. **`easeInOut`** only for things already moving on their own — auto-
   pulse, scrubbing, etc.
4. **Animate `transform` and `opacity` only.** Anything else triggers
   layout/paint and will drop frames. If you need a height transition,
   use `transform: scaleY` against a fixed container.
5. **Never animate repeated actions.** Scroll, repeated keypresses,
   typing into a free `<input>` — these fire too often. The PIN-style
   keypad we may add gets press feedback per press because each press
   is a discrete user moment.
6. **Test in slow motion.** Set the `?slow=1` query param (we wire this
   in `useMotionTokens`) and watch each frame. Mistimings only show up
   slowed down.
7. **Respect `prefers-reduced-motion`.** Framer's `useReducedMotion`
   plus our `useMotionPrefs` helper short-circuits non-essential motion
   to instant. Keep haptics + color shifts.

## 4. Spring physics over easings (where applicable)

Springs are the default for **interactive state transitions** — sheets,
press feedback, drags, dismissals. They:

- Are interruptible by design (Framer Motion mid-flight redirect).
- Respect gesture velocity when handed it.
- Settle organically.

Springs are **not** the default for "decoration that loops" (cursor
parallax, ambient pulses) — that's `easeInOut` with a timed loop.

Use the named springs in `SPRINGS`. Custom configs need a comment
explaining why.

## 5. Action → reaction (the 3-tier feedback model)

Every interactive element should answer all three:

1. **Acknowledgement (< 100ms)**: scale, color shift, or haptic the
   instant the touch lands. Use `whileTap={{ scale: 0.97 }}` or our
   `<PressableScale>`. Pair commit-level actions with
   `useHaptic().medium()`.
2. **Effect (100–400ms)**: the actual state change, animated.
3. **Resolution**: success/error tone for commit-level actions. Toast,
   pill morph, or a settle pulse on the destination element.

If reaction 1 happens and reaction 2 doesn't, the app feels frozen. If
reaction 2 happens without reaction 1, taps feel "lossy."

## 6. Origin-aware motion

Animations should grow *from* the trigger, not from screen-center.

- **Modal/popover** triggered by a button → `transformOrigin` set to
  where the trigger sits (`top right`, `top center`, etc.). Framer
  Motion respects `transformOrigin` on `motion.div`.
- **Bottom-nav active pill** → use `layoutId="bottom-nav-active"`. The
  Framer Motion layout engine animates the pill smoothly between tabs.
  No bespoke math.
- **Status pill changing color** → don't shift its position; animate
  `backgroundColor` only. Movement that doesn't communicate location
  change is noise.

## 7. Component continuity — move, don't duplicate

> *If you can point at any element before a navigation, you should be
> able to point at it after — it should have moved, not faded out + in.*

Framer Motion's `layoutId` is our primary tool. Tag the same element
across two screens with the same `layoutId` and it interpolates frames
during the route transition (we wrap the page tree in
`<AnimatePresence>` for this).

Apply it to:

- **`/order/[id]` amount → success-state amount.** Same number, same
  identity. `layoutId="order-amount"`. The user *sees* the value travel
  from the review row to the success headline — answers "did the app
  understand what I'm paying?" without making them re-read.
- **Activity row → `/tx/[digest]` headline.** Tapped row's amount
  becomes the receipt headline.
- **Bottom-nav active pill** (already noted above).

The litmus test: **if a logical element exists on both sides of a
navigation, it should travel — not fade out then fade in.**

## 8. Money flows — motion is a safety mechanism

In the rest of the app motion is polish. In money flows it's *trust*.
When the user enters `$25 USDC` on /pay-review and confirms on the
success screen, two questions live in their head: *did the app
understand?* and *is the value I'm confirming the same one I entered?*

A static cut leaves both unanswered. A shared-element transition
answers both at once — the value is visibly the same element across
the boundary.

Hard rules for money flows:

- The displayed amount must persist visually across the transition.
- Format must be identical at every step (don't show `$25.00` then
  `25 USDC`).
- A loading spinner must never replace the amount during quote refresh.
  The amount stays put; the rate label below updates.
- Don't "celebrate" before the server confirms — no success animations
  on the review screen, only after the digest lands.

## 9. Post-action wayfinding (not yet wired)

> *The spinner travels to its home tab.*

When the user commits an action, the loading indicator should
physically fly from the action surface to the surface where the result
will live. Not yet built in Tapp — scaffolding planned:

- Pay success → indicator flies into the **Activity** tab; tab badge
  pulses until the tx settles.
- Deposit lands → indicator flies into the **Wallet** tab; balance
  pulses on update.
- Card linked → indicator flies into the **Settings** tab → Card row.

The scaffold needs: a portal-mounted `<FlyingIndicator>`, a zustand
store tracking source/target, and tab-icon badge slots that can spin.
Track in `docs/motion-guidelines.md` § "Open work" until shipped.

## 10. Performance budget — 60fps or it didn't happen

- Animate `transform` + `opacity` only. Anything else triggers layout
  and drops frames the moment the JS thread is busy.
- Framer Motion lifts animations to the compositor automatically when
  you stick to transform/opacity. Don't animate `width`, `height`,
  `padding`, `top`, `left`.
- Avoid kicking heavy animations during first paint or query refetch.
  Defer with `requestAnimationFrame` if you must.
- Profile with React DevTools Profiler + Chrome Performance trace on
  any screen with > 3 concurrent animations.

## 11. Cohesion — the curve fingerprint

Every animation in Tapp should feel like it came from the same
designer. Reach for `lib/motion.ts` first. If you must add a new
curve/duration, name it as a constant and document why.

Default vocabulary (do not deviate without reason):

- Page swap: `PAGE_VARIANTS` + `easeOut` + 200–240ms.
- Press feedback: `<PressableScale>` (spring, `tight`).
- Sheet/modal entry: Headless UI `<Transition>` with `easeOut` curve,
  240ms.
- Status pill color flip: `motion.span` `animate={{ backgroundColor }}`
  with `easeOut` + 200ms.
- Number landing on mount: `<CountUp>` with `1.0s` ease-out cubic.

## 12. Patterns by interaction type

### Buttons & CTAs

Every tappable surface gets press scale + haptic. The `<Button>`
primitive already has `active:scale-95` via Tailwind. For other
tappable surfaces (`<Link>` rows, list cells, tabs), wrap in
`<PressableScale>`.

Haptic tiers:

- **Light** (`useHaptic().light()`): nav taps, list rows, tabs.
- **Medium** (`useHaptic().medium()`): commit actions — Pay confirm,
  Top-up sign, Revoke confirm.
- **Success** (`useHaptic().success()`): payment confirmed,
  deposit landed. Sparingly.
- **Error** (`useHaptic().error()`): declined tap, failed sign.

On iOS Safari `navigator.vibrate` is a no-op — that's fine. Android
Chrome, Samsung Internet, and most Android PWA shells honor it.

### Numbers & balances

- **Mount count-up** on the balance hero. `<CountUp value={subunit}>`
  rolls from 0 to target over ~1s with `easeOut` cubic. Only on first
  arrival — subsequent updates animate the *delta* (changed digits
  slide), not re-roll from zero.
- **Format must be stable.** Don't switch between `72.50 USDC` and
  `72.5 USDC` between states.
- **Skip the count for values < 1** — it lands as a glitch.

### Lists / activity rows

- Wrap each row in `<PressableScale>` so the tap feels acknowledged.
- Status changes (pending → success) animate `backgroundColor` and
  icon color on the chip; don't re-mount the row.
- Long lists: stagger entrance with `transition: { delay: index * 0.04 }`
  via `<AnimatedComponent>`. Cap stagger at ~5 items (otherwise the
  last row mounts too late).

### Loading → loaded

- Wrap conditional `{loading ? <A/> : <B/>}` in `<CrossFade>` which
  uses `<AnimatePresence mode="wait">` + a shared `motion.div` key.
- The hero balance gets a *skeleton* (gray block, dimensions match the
  rendered hero) — not a spinner. Spinners say "we're working" but
  the user wanted the *answer*, not a status.
- Spinner is for actions, not for first-render data.

### Sheets & modals

- Use Headless UI `<Transition>` with our `CURVES.easeOut`,
  `DURATIONS.normal`. Default backdrop = `bg-black/25 backdrop-blur-sm`.
- The panel grows from `scale: 0.95` + `opacity: 0` to `1, 1`. Backdrop
  is a simple fade.
- If the modal is triggered by an off-center button, set
  `transformOrigin` so it grows from the trigger area.

### Bottom-nav tabs

- Tap a tab → light haptic + the active pill morphs into place via
  `layoutId="bn-active"`.
- The Pay FAB gets the same haptic + slight scale dip on press.
- Don't animate the bar background or the labels — only the active pill.

### Status pills

- One element, animated color. `motion.span` `animate={{ backgroundColor,
  color }}` with `easeOut` 200ms.
- Icon swap (clock → check) cross-fades with `<AnimatePresence
  mode="wait">`.

### Page transitions

- The current `<AnimatedComponent variant={slideInOut}>` wrapper does
  the route entry. `slideInOut` is `y: 20 → 0 → -20` with `0.4s`
  anticipate — **too long**. Update to `y: 12 → 0 → -12`, `0.24s
  easeOut`. The anticipate curve stays for rare moments only.

## 13. Reduced motion

```ts
import { useMotionPrefs } from "@/lib/motion";

const { reduced } = useMotionPrefs();
const variants = reduced ? STATIC_VARIANTS : SLIDE_IN_OUT;
```

- Keep haptics and color shifts.
- Drop travel and scale animations.
- Replace springs with instant transitions.

## 14. Anti-patterns to remove on sight

| Don't | Do instead |
|---|---|
| `{loading ? <A /> : <B />}` with no animation | Wrap in `<CrossFade>` |
| Conditional `<motion.div animate={isOpen ? ... : ...}>` for repeated state | Move to `whileHover`/`whileTap` or layout-driven `layoutId` |
| `transition: { duration: 0.5 }` on routine page swaps | Cap at 0.24s |
| Pop-changing numbers in finance contexts | `<CountUp>` for mount, `<AnimatedAmount>` for in-place change |
| Press feedback only on `<Button>` | Wrap any tappable surface in `<PressableScale>` |
| Different easings per component | Centralize in `lib/motion.ts` |
| Animating `height`, `width`, layout props | Use `scaleY` / `scaleX` against a fixed container |
| Re-mounting a logically-persistent element | Use `layoutId` to share it |
| Celebration on every iteration of a recurring action | Reserve for rare milestones |
| Loading spinner replacing an amount during quote refresh | Skeleton beside the value; never on top |
| Modal that ignores `prefers-reduced-motion` | Read `useMotionPrefs()`, short-circuit travel |

## 15. PR checklist

If a PR adds new UI, ask:

1. Does every tappable surface have a press reaction (scale + haptic)?
2. Are state changes morphed or swapped? No
   `{loading ? <A/> : <B/>}` without a cross-fade.
3. Are numbers transitioning, or popping? Mount count-up for
   server-driven headlines; in-place morph for updating values.
4. Are durations under 300ms for routine transitions?
5. Animation only on `transform` and `opacity`?
6. Easing from `CURVES.easeOut` (or a documented exception)?
7. Springs from `SPRINGS.*` (or a documented exception)?
8. Does the animation have a *purpose*? Remove it and re-ask "did
   information get lost?"
9. Does it originate from the right place? Off-center triggers should
   grow from their corner.
10. Can it be interrupted (open → immediately close mid-flight smoothly)?
11. Respects `prefers-reduced-motion`?
12. For money flows: can the user still see the same amount they
    entered on every screen?
13. For commit actions: does the indicator fly to where the result
    will live, or just vanish? (Not yet wired — track.)
14. For neglected surfaces: did you leave it at least slightly more
    polished than you found it?

Three or more "no"s → not ready. Motion is what makes Tapp feel like
*ours*; without it we ship a spreadsheet.

## 16. Currently shipped (don't re-open without reading the linked code)

- `lib/motion.ts` — tokens, `useMotionPrefs`, `useHaptic`.
- `components/ui/AnimatedComponents.tsx` — page/component wrappers,
  variants, reduced-motion-aware.
- `components/ui/PressableScale.tsx` — wraps any element with scale +
  haptic on press; respects reduced-motion.
- `components/ui/CountUp.tsx` — mount-time number roll-up; skips
  values < 1; re-roll-suppressed by render-key.
- `components/ui/CrossFade.tsx` — `<AnimatePresence mode="wait">`
  swap helper for loading/loaded branches.
- `BottomNav` — `layoutId="bn-active"` pill morphs between tabs;
  haptic on press; FAB scale on press.
- `BalanceHero` — uses `<CountUp>` for first-arrival; keeps NGN
  secondary stable.
- `ActivityRow` — wrapped in `<PressableScale>`; row press is
  acknowledged.
- `/wallet` — loading/loaded uses `<CrossFade>`.
- `/order/[id]` — `useHaptic().medium()` on confirm, `.success()` on
  done, `.error()` on failure; amount carries `layoutId="order-amount"`
  through to the success state.

## 17. Open work

- Per-digit amount entry (`<AnimatedDigits>`) for any future free-text
  amount inputs (top-up, send-arbitrary).
- Post-action wayfinding scaffolding (portal + flying indicator + tab
  badge slots).
- Multi-step flow choreography (`StepHeader`-style) for the link
  wizard. Today it's plain page navigation — fine for v1.
- Origin-aware modal grow from trigger button. Today FundCardModal
  grows from screen-center.
- Tab directional flash on bottom-nav switch (left-tap → flash right,
  right-tap → flash left). Adds spatial cue.

The last four are real but lower priority than the in-app gaps.
