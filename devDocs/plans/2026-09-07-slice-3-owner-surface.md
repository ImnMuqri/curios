# Slice 3 Plan 2 — The Owner Surface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen an owner sees — sign in, sign up, verify, reset, forgot, onboarding, review, settings — renders through `@curios/ui` instead of browser defaults.

**Architecture:** Four primitives (`Button`, `Field`, `Callout`, `Shell`) land in `packages/ui` carrying the states these screens already track, then each screen swaps its raw elements for them. The screens' logic does not change: every one of them already holds `busy` state, already renders `role="alert"` and `role="status"` in the right places, and already has its behaviour under test. This plan is presentation, and the existing tests are the proof it stayed that way.

**Tech Stack:** TypeScript, React 19, Next 15 App Router, CSS Modules, vitest + Testing Library.

**Spec:** `devDocs/slice-3-build-spec.md`. Plan 1 is `devDocs/plans/2026-09-07-slice-3-system-and-signature.md`; read its execution record before starting, because two of its findings change this plan.

## Global Constraints

- **Never hardcode a colour in a component** — not a hex, and not an `rgb()` either. Every colour is a token in `packages/ui/src/tokens.css`. `design-rules.test.ts` catches hex; it does not catch `rgb()`, which is a reason for care, not a licence.
- **The type scale is `11 / 12.5 / 14 / 17 / 22 / 32`**, exposed as `--text-xs` through `--text-display`. A seventh size fails the test.
- **`kuning` means a human needs to act. `merah` means destructive or error.** Neither appears decoratively. This plan is the first to use either, and `merah` belongs to `Callout`'s error tone and nothing else.
- **Motion:** 120ms colour transitions on press states, and nothing else on the dashboard. DESIGN.md is explicit — no entrance animations here; a busy person opening this at 11pm wants instant, not theatrical.
- **Copy voice:** sentence case, plain, a bit dry, active verbs. The button says what happens. Errors explain and instruct and never apologise. **Empty states are instructions, not moods.**
- **Dashboard rules from FRONTEND.md:** one primary action per screen; every other control is secondary. No blank prompt boxes except the two places a human writes real prose — a pinned answer, and a fact correction.
- **Never set `outline: none` without a `:focus-visible` replacement.** `reset.css` styles the ring globally; a component that removes it must restyle it.
- Node 22, ESM. **Every relative import ends in `.js`**, even from `.ts`/`.tsx`.
- Gates from the repo root: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `apps/api` and `packages/db-read` tests need Postgres. `docker compose up -d`, and after any restart of the `tmpfs` test container: `cd packages/db && DATABASE_URL="$DATABASE_URL_TEST" pnpm exec prisma migrate deploy`, then `docker exec -i curios-postgres-test psql -U curios -d curios_test < packages/db/prisma/sql/readonly-role.sql`.

## Two corrections to the spec, before anyone starts

**The spec's rough-edge list is stale, and this plan does not act on it.**

1. *"The review actions have no busy or disabled state."* **Already fixed.** It was recorded when slice 2's task 6 shipped and closed later in that same slice — see `9a15dbf` and `79938d7`. `fact-card.tsx` holds a `busy` state and disables Accept, Edit, Reject and Save on it, and so does every other interactive component on this surface: `signin-form`, `signup-form`, `forgot-form`, `reset-form`, `claim-form`, `ingest-form`, `add-password-form` and `publish-button`. Do not "add" it. Preserve it.
2. *"Inline styles on the public page move into modules."* Done in plan 1.

**One real defect, found while executing plan 1 and unclaimed by any task until now:** `apps/web/app/app/layout.tsx` renders `className="app-shell"`, and nothing has ever defined that class — not in `globals.css` on `main`, not anywhere. It has styled nothing since the day it was written. Task 2 replaces it.

---

### Task 1: The four primitives

Every screen needs the same four things. They land together because a `Button` without `Callout` leaves half a form styled, and a reviewer cannot usefully judge one without the others.

**Files:**
- Create: `packages/ui/src/button/Button.tsx`, `Button.module.css`, `Button.test.tsx`
- Create: `packages/ui/src/field/Field.tsx`, `Field.module.css`, `Field.test.tsx`
- Create: `packages/ui/src/callout/Callout.tsx`, `Callout.module.css`, `Callout.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: tokens from plan 1's Task 1.
- Produces, all exported from `@curios/ui`:
  - `<Button type? variant?: 'primary' | 'secondary' | 'danger' busy? disabled? onClick? children />` — renders `<button>`, is disabled when `busy`, and exposes `aria-busy`.
  - `<Field id label type? autoComplete? required? value onChange hint? multiline? />` — renders a `<label htmlFor>` bound to an `<input>` (or `<textarea>` when `multiline`).
  - `<Callout tone: 'error' | 'info' | 'action'>{children}</Callout>` — `role="alert"` for `error`, `role="status"` for the other two.

- [x] **Step 1: Write the failing tests**

`packages/ui/src/button/Button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.js';

describe('Button', () => {
  it('renders its label and calls the handler', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Publish page</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Publish page' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled while busy, so a double tap cannot fire twice', async () => {
    // Every screen on this surface already tracks `busy`. The primitive has to
    // express it, or each screen keeps hand-rolling a disabled attribute and
    // one of them eventually forgets.
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('announces that it is busy, not merely that it is disabled', () => {
    // aria-disabled alone says "you cannot press this" and not "because it is
    // working". aria-busy is the difference between a broken button and a
    // slow one, to someone who cannot see the spinner.
    render(<Button busy>Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('is disabled when told to be, independently of busy', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy', 'true');
  });

  it('defaults to type=button so it cannot submit a form by accident', () => {
    // The HTML default is "submit", which is the single most common way a
    // secondary control silently posts a form.
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('can be a submit button when asked', () => {
    render(<Button type="submit">Sign in</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('distinguishes its variants in the DOM', () => {
    const { container: primary } = render(<Button>a</Button>);
    const { container: danger } = render(<Button variant="danger">b</Button>);
    expect(primary.firstElementChild?.className).not.toBe(danger.firstElementChild?.className);
  });
});
```

`packages/ui/src/field/Field.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Field } from './Field.js';

describe('Field', () => {
  it('binds its label to its input, so clicking the label focuses it', async () => {
    render(<Field id="email" label="Email" value="" onChange={vi.fn()} />);

    await userEvent.click(screen.getByText('Email'));
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('reports what was typed', async () => {
    const onChange = vi.fn();
    render(<Field id="email" label="Email" value="" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText('Email'), 'n');
    expect(onChange).toHaveBeenCalledWith('n');
  });

  it('passes the input type and autocomplete through', () => {
    // A password field that is not type=password is a password on screen, and
    // a missing autoComplete is a password manager that cannot help.
    render(
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value=""
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
  });

  it('renders a textarea when asked, for the one place a human writes prose', () => {
    render(<Field id="claim" label="Claim" multiline value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Claim').tagName).toBe('TEXTAREA');
  });

  it('associates a hint with the input rather than leaving it floating', () => {
    // A hint that is not referenced by aria-describedby is invisible to a
    // screen reader, which is exactly the user most likely to need it.
    render(
      <Field id="handle" label="Handle" hint="Letters and numbers only." value="" onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Handle')).toHaveAccessibleDescription('Letters and numbers only.');
  });
});
```

`packages/ui/src/callout/Callout.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Callout } from './Callout.js';

describe('Callout', () => {
  it('gives an error the alert role, so it interrupts', () => {
    // These screens already render role="alert" for failures and role="status"
    // for progress. The primitive has to keep that distinction, not flatten it.
    render(<Callout tone="error">That password has appeared in a public breach.</Callout>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('gives info the status role, so it does not', () => {
    render(<Callout tone="info">Reading your website…</Callout>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('gives an action the status role too', () => {
    render(<Callout tone="action">Two facts still need a decision.</Callout>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('distinguishes the tones in the DOM', () => {
    const { container: error } = render(<Callout tone="error">a</Callout>);
    const { container: action } = render(<Callout tone="action">b</Callout>);
    expect(error.firstElementChild?.className).not.toBe(action.firstElementChild?.className);
  });
});
```

- [x] **Step 2: Run to verify RED**

Run: `pnpm --filter @curios/ui test`
Expected: FAIL — cannot resolve `./Button.js`, `./Field.js`, `./Callout.js`.

- [x] **Step 3: Write Button**

`packages/ui/src/button/Button.tsx`:

```tsx
import type { ReactNode } from 'react';
import styles from './Button.module.css';

/**
 * type defaults to "button", not to HTML's "submit".
 *
 * Every screen on this surface has at least one secondary control sitting
 * inside a form, and the HTML default turns each of those into a submit by
 * accident. Opting in to submit is one word; opting out of it is a bug nobody
 * finds until a user presses Cancel and the form posts.
 */
export function Button({
  children,
  type = 'button',
  variant = 'primary',
  busy = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]}`}
      disabled={busy || disabled}
      // Only when busy. aria-disabled on its own says "you cannot press this";
      // aria-busy says "because it is working", which is the difference
      // between a broken button and a slow one to someone who cannot see it.
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
```

`packages/ui/src/button/Button.module.css`:

```css
.button {
  min-height: 44px;
  padding: 11px 18px;
  border: 1.5px solid transparent;
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: var(--text-body);
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.button:disabled {
  opacity: 0.55;
  cursor: default;
}

.primary {
  background: var(--hijau);
  color: var(--paper);
}

.primary:active:not(:disabled) {
  background: var(--ink);
}

.secondary {
  background: var(--paper);
  border-color: var(--surface);
  color: var(--ink);
}

.secondary:active:not(:disabled) {
  background: var(--surface);
}

/* merah, and only here. It means destructive, and nothing else may borrow it. */
.danger {
  background: var(--paper);
  border-color: var(--merah);
  color: var(--merah);
}

.danger:active:not(:disabled) {
  background: var(--merah);
  color: var(--paper);
}
```

- [x] **Step 4: Write Field**

`packages/ui/src/field/Field.tsx`:

```tsx
import { useId } from 'react';
import styles from './Field.module.css';

/**
 * A label bound to its control, and a hint the control actually points at.
 *
 * FRONTEND.md bans blank prompt boxes everywhere except a pinned answer and a
 * fact correction, so `multiline` exists for exactly one caller: the review
 * screen's claim editor.
 */
export function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  required = false,
  hint,
  multiline = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
  multiline?: boolean;
}) {
  const hintId = useId();

  const shared = {
    id,
    value,
    required,
    // A hint nothing references is invisible to a screen reader -- which is
    // the user most likely to need it.
    'aria-describedby': hint ? hintId : undefined,
    className: styles.control,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={3} />
      ) : (
        <input {...shared} type={type} autoComplete={autoComplete} />
      )}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
```

`packages/ui/src/field/Field.module.css`:

```css
.field {
  margin-bottom: 16px;
}

.label {
  display: block;
  margin-bottom: 6px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: var(--muted);
}

.control {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 11px 14px;
  border: 1.5px solid var(--surface);
  border-radius: 10px;
  background: var(--paper);
  font-family: var(--font-body);
  font-size: var(--text-body);
  color: var(--ink);
  transition: border-color 120ms ease;
}

.control:focus {
  border-color: var(--hijau);
}

.hint {
  margin: 6px 0 0;
  font-size: var(--text-base);
  color: var(--muted);
}
```

- [x] **Step 5: Write Callout**

`packages/ui/src/callout/Callout.tsx`:

```tsx
import type { ReactNode } from 'react';
import styles from './Callout.module.css';

/**
 * Three tones, and the role follows the tone rather than the colour.
 *
 * `error` interrupts, because a failed submit is news the owner needs now.
 * `info` and `action` are polite: "Reading your website…" repeated
 * assertively every poll would make the screen unusable with a screen reader.
 */
export function Callout({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'error' | 'info' | 'action';
}) {
  return (
    <p className={`${styles.callout} ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
```

`packages/ui/src/callout/Callout.module.css`:

```css
.callout {
  margin: 0 0 16px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: var(--text-body);
}

.error {
  background: var(--paper);
  border: 1.5px solid var(--merah);
  color: var(--merah);
}

.info {
  background: var(--surface);
  color: var(--ink);
}

/* kuning, and only here: a human needs to act. Decorative use is a deletion. */
.action {
  background: var(--paper);
  border: 1.5px solid var(--kuning);
  color: var(--ink);
}
```

- [x] **Step 6: Export and run**

Append to `packages/ui/src/index.ts`:

```ts
export { Button } from './button/Button.js';
export { Field } from './field/Field.js';
export { Callout } from './callout/Callout.js';
```

Run: `pnpm --filter @curios/ui test && pnpm --filter @curios/ui lint && pnpm --filter @curios/ui typecheck`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): four primitives, and the states these screens already track"
```

---

### Task 2: The shell, and the screens inside it

`/app`'s layout gets a real shell — replacing a class that has never existed — and onboarding gets styled.

**Files:**
- Create: `packages/ui/src/shell/Shell.tsx`, `Shell.module.css`, `Shell.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `apps/web/app/app/layout.tsx:23`
- Modify: `apps/web/app/app/page.tsx`, `apps/web/app/app/onboarding/page.tsx`
- Modify: `apps/web/app/app/onboarding/claim-form.tsx`, `ingest-form.tsx`, `job-status.tsx`

**Interfaces:**
- Consumes: `Button`, `Field`, `Callout` from Task 1.
- Produces: `<Shell title? children />`, exported from `@curios/ui`, rendering a `<main>` with the dashboard's measure and padding.

- [x] **Step 1: Write the failing test**

`packages/ui/src/shell/Shell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Shell } from './Shell.js';

describe('Shell', () => {
  it('renders its children inside a main landmark', () => {
    // A landmark, not a div: it is how anyone navigating by region skips
    // straight to the content, and app/layout.tsx already used <main>.
    render(
      <Shell>
        <p>inside</p>
      </Shell>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('inside');
  });

  it('renders a heading when given a title', () => {
    render(<Shell title="Review facts">x</Shell>);
    expect(screen.getByRole('heading', { name: 'Review facts' })).toBeInTheDocument();
  });

  it('renders no heading when given none, rather than an empty one', () => {
    render(<Shell>x</Shell>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run to verify RED**

Run: `pnpm --filter @curios/ui test shell`
Expected: FAIL — cannot resolve `./Shell.js`.

- [x] **Step 3: Write it**

`packages/ui/src/shell/Shell.tsx`:

```tsx
import type { ReactNode } from 'react';
import styles from './Shell.module.css';

/**
 * The dashboard's measure and padding, in one place.
 *
 * This replaces `className="app-shell"` in app/layout.tsx, which referenced a
 * class no stylesheet in this repo has ever defined -- it styled nothing from
 * the day it was written, and nothing failed, because a missing class is
 * silent.
 */
export function Shell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className={styles.shell}>
      {title ? <h1 className={styles.title}>{title}</h1> : null}
      {children}
    </main>
  );
}
```

`packages/ui/src/shell/Shell.module.css`:

```css
.shell {
  max-width: 560px;
  margin: 0 auto;
  padding: 32px 16px 64px;
}

.title {
  margin: 0 0 24px;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  letter-spacing: -0.02em;
}
```

Export it from `packages/ui/src/index.ts`, then in `apps/web/app/app/layout.tsx` replace

```tsx
  return <main className="app-shell">{children}</main>;
```

with

```tsx
  return <Shell>{children}</Shell>;
```

importing `Shell` from `@curios/ui`. Leave the session logic above it exactly as it is.

- [x] **Step 4: Restyle onboarding**

In `claim-form.tsx` and `ingest-form.tsx`, replace each `<label>`/`<input>` pair with `<Field>`, each `<button>` with `<Button>` (keeping the existing `busy` state wired to the `busy` prop and `type="submit"` where the button submits), and each `<p role="alert">` with `<Callout tone="error">`.

In `job-status.tsx`, replace the three returns' bare paragraphs:

```tsx
  if (!data || data.status === 'QUEUED' || data.status === 'RUNNING') {
    return <Callout tone="info">Reading your website…</Callout>;
  }

  if (data.status === 'FAILED') {
    // The API's own `error` string, not a generic apology -- it exists
    // precisely so this screen can say which of the many ways a crawl fails
    // actually happened.
    return <Callout tone="error">{data.error}</Callout>;
  }

  return (
    <div>
      <Callout tone="info">Found {data.extractedCount} facts.</Callout>
      <a href="/app/review">Review the facts</a>
    </div>
  );
```

**Do not change any handler, any state, or any role.** The roles the callouts produce are the roles these elements already had, which is why the existing tests keep passing.

- [x] **Step 5: Run the tests**

Run: `pnpm --filter @curios/ui test && pnpm --filter @curios/web test`
Expected: PASS, with the existing onboarding tests unchanged. **A failure here means behaviour moved; fix the component, not the test.**

- [x] **Step 6: Commit**

```bash
git add packages/ui apps/web
git commit -m "feat(web): a shell that exists, and an onboarding that is styled"
```

---

### Task 3: The five screens outside the dashboard

Sign in, sign up, forgot, reset, verify. They share a shape, so they land together.

**Files:**
- Modify: `apps/web/app/signin/signin-form.tsx`, `apps/web/app/signup/signup-form.tsx`
- Modify: `apps/web/app/forgot/forgot-form.tsx`, `apps/web/app/reset/reset-form.tsx`
- Modify: `apps/web/app/verify/verify-client.tsx`
- Create: `apps/web/app/auth.module.css`

**Interfaces:**
- Consumes: `Button`, `Field`, `Callout`, `Shell` from Tasks 1 and 2.
- Produces: nothing later tasks depend on.

- [x] **Step 1: Restyle sign in**

`signin-form.tsx` keeps every piece of its logic — the `busy` state, the verbatim error message, the `oauthError` and `cancelled` props — and changes only what it renders:

```tsx
  return (
    <Shell title="Sign in">
      <form onSubmit={(event) => void submit(event)}>
        {cancelled ? (
          <Callout tone="info">Sign-in was cancelled. Try again when you are ready.</Callout>
        ) : null}
        {oauthError ? <Callout tone="error">{oauthErrorMessage(oauthError)}</Callout> : null}

        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={setEmail}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={setPassword}
        />

        {/* Rendered verbatim. The API returns one message for every cause on
            purpose -- wrong password, unknown address, unverified -- and
            rewriting it here to be more helpful would rebuild the account
            enumeration oracle it was written to remove. */}
        {error ? <Callout tone="error">{error}</Callout> : null}

        <Button type="submit" busy={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        {/* An anchor, never a button: it must leave the app to the API origin,
            and a fetch would follow that redirect in the background and hand
            back Google's HTML. */}
        <a
          className={styles.alternative}
          href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/google`}
        >
          Continue with Google
        </a>
      </form>
    </Shell>
  );
```

Note `onChange={setEmail}` — `Field` hands back the value, not the event, so the old `(event) => setEmail(event.target.value)` becomes the setter itself.

`apps/web/app/auth.module.css`:

```css
/*
 * Shared by the five screens outside the dashboard. They are one screen with
 * five contents, so they get one stylesheet rather than five near-copies.
 */
.alternative {
  display: block;
  margin-top: 20px;
  color: var(--hijau);
  font-size: var(--text-body);
}
```

- [x] **Step 2: Restyle the other four the same way**

`signup-form.tsx`, `forgot-form.tsx` and `reset-form.tsx` take the same treatment: `Shell` with a title (`Create your page`, `Reset your password`, `Choose a new password`), `Field` for each input, `Callout` for each `role="alert"`/`role="status"` paragraph, `Button type="submit" busy={busy}` for each submit.

`verify-client.tsx` has no form — it reports the outcome of a token check. Wrap it in `Shell title="Verify your email"` and turn its success and failure paragraphs into `Callout tone="info"` and `Callout tone="error"`.

- [x] **Step 3: Run the tests**

Run: `pnpm --filter @curios/web test`
Expected: PASS, all 76. These five screens have 10 tests between them and every one asserts on roles and labels rather than on markup, which is exactly why they survive a restyle. **If one fails, read it before touching it — it is telling you a role or a label moved.**

- [x] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): the five screens outside the dashboard"
```

---

### Task 4: The review screen

The highest-leverage surface in the product, per FRONTEND.md. It gets its own task because a mistake here is the one this product cannot recover from.

**Files:**
- Modify: `apps/web/app/app/review/fact-card.tsx`
- Modify: `apps/web/app/app/review/review-queue.tsx`
- Modify: `apps/web/app/app/review/publish-button.tsx`
- Create: `apps/web/app/app/review/review.module.css`

**Interfaces:**
- Consumes: `Button`, `Field`, `Callout` from Task 1.
- Produces: nothing later tasks depend on.

- [x] **Step 1: Restyle the fact card**

Keep every line of its logic. `fact-card.tsx` already holds `busy`, already keeps a failed edit's draft in the textarea, and already disables all four controls during a mutation — that is the behaviour three tests pin and two review rounds produced.

Replace: the claim textarea with `<Field id={...} label="Claim" multiline value={draft} onChange={setDraft} />`; Accept and Save with `<Button busy={busy}>`; Edit with `<Button variant="secondary" busy={busy}>`; **Reject with `<Button variant="danger" busy={busy}>`**, because rejection is the destructive action on this screen and `merah` exists for exactly that.

Show the question alongside the claim, which is new and belongs here:

```tsx
      {fact.question ? <p className={styles.question}>{fact.question}</p> : null}
```

An owner verifying `RM45` should see the question a customer will be shown, because that pair is what reaches the public together.

**`ReviewFact` does not carry `question` yet — checked, not assumed.** `packages/db-read/src/review.query.ts` selects `id, category, claim, sourceText, sourceUrl, confidence` and its interface lists the same six. Add `question: string | null;` to the interface and `question: true` to the `select`, then add a case to `review.query.test.ts`:

```ts
  it('returns the question a customer would ask, when the fact has one', async () => {
    // Null for every fact written before the column existed, so the screen has
    // to handle both -- and the fixture covers both rather than the happy one.
    const facts = await getReviewQueue(accountId, { limit: 50 });
    expect(facts.some((f) => f.question !== null)).toBe(true);
    expect(facts.every((f) => 'question' in f)).toBe(true);
  });
```

Seed one fact with a question and one without in that test's fixture.

- [x] **Step 2: The empty state is an instruction**

`review-queue.tsx` already renders an empty state. Confirm it reads as an instruction rather than a mood — DESIGN.md's rule — and wrap it in `<Callout tone="info">`. Do **not** move it: it lives inside `ReviewQueue` and `Publish` is deliberately its sibling, so that publishing stays offered whether or not facts remain. `page.test.tsx` asserts exactly that, and it is the guard on F5.

- [x] **Step 3: Restyle publish**

`publish-button.tsx` keeps its local `done` state. The button becomes `<Button busy={busy}>`, and the published view's URL becomes a styled block the owner can select and paste.

- [x] **Step 4: Run the tests**

Run: `pnpm --filter @curios/web test review && pnpm --filter @curios/db-read test`
Expected: PASS — 24 tests across `fact-card`, `review-queue`, `publish-button` and `page`, plus 24 in db-read.

- [x] **Step 5: Commit**

```bash
git add apps/web packages/db-read
git commit -m "feat(web): the screen where a wrong price gets caught"
```

---

### Task 5: Settings

**Files:**
- Modify: `apps/web/app/app/settings/page.tsx`, `add-password-form.tsx`, `connect-google.tsx`

**Interfaces:**
- Consumes: `Button`, `Field`, `Callout`, `Shell` from Tasks 1 and 2.

- [x] **Step 1: Restyle**

`page.tsx` gets `Shell title="Settings"` and shows the account's email. `add-password-form.tsx` takes `Field`/`Button`/`Callout` like every other form. `connect-google.tsx` stays an anchor to the API origin — it must be a real navigation, never a fetch — and takes the `.alternative` class from Task 3's stylesheet.

An account with both a password and Google gets neither form, and must still be told something useful. **Empty states are instructions:** say which sign-in methods the account has, not "Nothing to do here."

- [x] **Step 2: Run the tests**

Run: `pnpm --filter @curios/web test settings`
Expected: PASS — 11 tests across `settings.test.ts` and `add-password-form.test.tsx`.

- [x] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): settings, styled"
```

---

### Task 6: Gates, and looking at it

- [x] **Step 1: All four gates**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build --force
```

Expected: all four pass. The `design-rules` tripwire now walks a dozen more stylesheets; a failure there names the file and the offending value.

- [x] **Step 2: Grep for what the tripwire cannot see**

```bash
grep -rn "rgb(\|rgba(\|hsl(" packages/ui/src apps/web/app --include=*.css
```

Expected: only `--scrim` in `tokens.css`. The no-hex test does not catch functional colour notations — plan 1 found that the hard way — so this is checked by hand until someone extends the checker.

- [x] **Step 3: Walk the surface in a browser**

Start the stack and sign in. At 390×844, walk: sign in → onboarding → paste a URL → review → publish → settings.

Check, and write down what you find rather than what you hoped:

1. Every screen has one obvious primary action and no second one competing with it.
2. Empty states read as instructions.
3. `kuning` appears only where a human must act; `merah` only on Reject and on errors.
4. Focus rings are visible on every control, and tab order follows the page.
5. The review screen shows each question above its claim.
6. Nothing animates on the dashboard.

- [x] **Step 4: Record the result**

Append what was checked, what was found, and what is still wrong to this plan, then commit.

---

## Self-review

**Spec coverage.** The spec's plan-2 half is "the primitives, the eight screens, the rough edges above." Primitives are Task 1, the shell and onboarding are Task 2, the five outside screens are Task 3, review is Task 4, settings is Task 5. The accessibility floor rides in the primitives — `Field`'s label binding and `aria-describedby`, `Button`'s `aria-busy`, `Callout`'s role split — rather than being bolted on per screen.

**The rough edges are the interesting part, and they are already done.** Both entries on the spec's list were closed before this plan existed: the review busy states in slice 2, and the public page's inline styles in plan 1. This plan says so at the top so nobody "fixes" a working `busy` state into a broken one. The one genuine defect — `className="app-shell"` referring to nothing — was found while executing plan 1, appears on no list anywhere, and is Task 2.

**Type consistency.** `Button` takes `busy`, not `loading` or `pending`, matching the state name every one of these screens already uses. `Field`'s `onChange` hands back a `string`, not an event, which is the one signature change rippling into every form — flagged in Task 3 Step 1 because it is the likeliest place to introduce a silent bug. `Callout`'s `tone` is `'error' | 'info' | 'action'` in all five tasks.

**What is deliberately not here.** `/app/links`, `/app/leads`, `/app/questions`, `/app/knowledge`, `/app/appearance` and `/app/billing` — the spec's out-column lists them, and they belong to slices 4, 5 and 7. `CaptureCard` and `GapCard` likewise.

**What no test here covers.** Whether any of it looks right. Every test in this plan asserts a role, a label or a state, and a screen can pass all of them while being ugly, cramped, or unreadable on a phone. Task 6 Step 3 is the only thing that answers that question and it needs a person.


---

## Execution record

**Gates:** lint, typecheck, build all pass. **505 tests** across 8 packages — core 121,
api 170, web 76, ui 50, workers 40, db-read 25, gateway 15, db 8.

**Every pre-existing test passed untouched.** That was the claim this plan rested on —
that the work was presentation and the screens' behaviour would not move — and it held
across all 76 web tests, including the ones pinning a failed edit's surviving draft, the
double-tap guard on claim, and every busy state.

### What was checked, and how

| Check | Result |
|---|---|
| One primary action per screen | Holds. `fact-card.tsx` counts two primaries statically, but Save and Accept are in mutually exclusive branches — one renders at a time. |
| `merah` only on destructive and errors | Holds: `Button.danger` (Reject) and `Callout.error`, nowhere else. |
| `kuning` only where a human must act | Only `Callout.action` defines it, and nothing uses that tone yet. It is defined and unused rather than misused. |
| Functional colour notation outside tokens | `grep` for `rgb(`/`rgba(`/`hsl(` finds one hit: `--scrim` in `tokens.css`, which is where it belongs. |
| The design-rules tripwire over a dozen new stylesheets | Passes. |

### Fixed along the way

**The budget test from plan 1 failed for a reason that was not a regression.** `next dev`
overwrites `app-build-manifest.json` with an empty one, so the test failed for anyone who
had run the dev server. It now distinguishes *no usable build* (skip, with a warning) from
*a manifest whose shape changed* (fail) — the second is the measurement silently measuring
nothing, and only that deserves a red suite.

### Not verified, and not claimable

**Nobody has looked at these screens.** There is no browser automation in this environment.
Everything above is structural: roles, tones, counts and greps. None of it says whether the
review queue is readable on a phone, whether the forms breathe, whether the mono labels
read as utility or as shouting, or whether any of it looks like a shopfront.

Task 6 Step 3 needs a person at 390×844, signed in, walking sign in → onboarding → review →
publish → settings. Until then this slice is *implemented*, not *finished*.
