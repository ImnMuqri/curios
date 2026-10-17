import type { ReactNode } from 'react';
import styles from './system.module.css';

/*
 * The System board's drawings, one per screen, at the board's coordinates.
 * Colours are classes in system.module.css, so they come from the tokens.
 */

const s = styles;
const cx = (...names: string[]) => names.map((name) => s[name]).join(' ');

function Ill({ children }: { children: ReactNode }) {
  return (
    <svg className={s.ill} viewBox="0 0 200 140" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Forgot: a password field swaying, a key flying off. */
export function ForgotArt() {
  return (
    <Ill>
      <circle cx="100" cy="72" r="58" className={s.fBiruMuda} />
      <g className={s.sway}>
        <rect x="58" y="52" width="84" height="44" rx="14" strokeWidth="2" className={cx('fCard', 'sEdge')} />
        <circle cx="78" cy="74" r="4" className={s.fBiru} />
        <circle cx="92" cy="74" r="4" className={s.fBiru} />
        <circle cx="106" cy="74" r="4" className={s.fBiru} />
        <circle cx="120" cy="74" r="4" className={cx('fBiruLembut', 'blinkd')} />
      </g>
      <g className={s.keyfly}>
        <circle cx="150" cy="40" r="12" fill="none" strokeWidth="5" className={s.sKuning} />
        <path d="M141 49l-18 18M128 62l6 6M123 67l5 5" strokeWidth="5" strokeLinecap="round" fill="none" className={s.sKuning} />
      </g>
    </Ill>
  );
}

/** A letter rising out of an envelope, in blue or (confirmed) green. */
export function LetterArt({ confirmed = false }: { confirmed?: boolean }) {
  return (
    <Ill>
      <circle cx="100" cy="74" r="58" className={confirmed ? s.fHijauMuda : s.fBiruMuda} />
      {confirmed ? (
        <g className={s.letter}>
          <rect x="70" y="30" width="60" height="58" rx="6" strokeWidth="2" className={cx('fCard', 'sHijauLine')} />
          <circle cx="100" cy="56" r="14" className={s.fHijau} />
          <path d="M93 56l5 5 10-10" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className={s.sCard} />
        </g>
      ) : (
        <g className={s.letter}>
          <rect x="70" y="34" width="60" height="58" rx="6" strokeWidth="2" className={cx('fCard', 'sEdge')} />
          <rect x="80" y="46" width="34" height="5" rx="2.5" className={s.fBiru} />
          <rect x="80" y="57" width="40" height="4" rx="2" className={s.fEdge} />
          <rect x="80" y="66" width="30" height="4" rx="2" className={s.fEdge} />
        </g>
      )}
      <path d="M56 70h88v42a8 8 0 0 1-8 8H64a8 8 0 0 1-8-8z" className={confirmed ? s.fHijau : s.fBiru} />
      <path d="M56 72l44 28 44-28" fill="none" strokeWidth="3" strokeLinejoin="round" className={confirmed ? s.sHijauDeep : s.sBiruDeep} />
    </Ill>
  );
}

/** Reset: a padlock whose shackle lifts. */
export function PadlockArt() {
  return (
    <Ill>
      <circle cx="100" cy="74" r="58" className={s.fUnguMuda} />
      <path d="M80 66V52a20 20 0 0 1 40 0v14" fill="none" strokeWidth="9" strokeLinecap="round" className={cx('shackle', 'sUngu')} />
      <rect x="66" y="64" width="68" height="52" rx="12" className={s.fUngu} />
      <circle cx="100" cy="86" r="7" className={s.fCard} />
      <rect x="97" y="88" width="6" height="14" rx="3" className={s.fCard} />
    </Ill>
  );
}

/** A broken link: two halves pulling apart, sparks between. */
export function BrokenLinkArt() {
  return (
    <Ill>
      <circle cx="100" cy="72" r="58" className={s.fMerahMuda} />
      <g className={s.lnkL}>
        <rect x="40" y="56" width="64" height="32" rx="16" fill="none" strokeWidth="9" className={s.sMerah} />
      </g>
      <g className={s.lnkR}>
        <rect x="96" y="56" width="64" height="32" rx="16" fill="none" strokeWidth="9" className={s.sMerahLembut} />
      </g>
      <path
        d="M100 34l-4 10M112 38l-6 8M88 38l6 8M100 110l-4-10M112 106l-6-8M88 106l6-8"
        strokeWidth="3"
        strokeLinecap="round"
        className={cx('zap', 'sKuning')}
      />
    </Ill>
  );
}

/** Changed: a green padlock, closed, with a tick popping on. */
export function ChangedArt() {
  return (
    <Ill>
      <circle cx="100" cy="72" r="58" className={s.fHijauMuda} />
      <path d="M80 64V52a20 20 0 0 1 40 0" fill="none" strokeWidth="9" strokeLinecap="round" className={s.sHijau} />
      <rect x="66" y="62" width="68" height="52" rx="12" className={s.fHijau} />
      <g className={s.pop2}>
        <circle cx="138" cy="62" r="20" className={s.fKuning} />
        <path d="M129 62l6 6 12-12" fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" className={s.sCard} />
      </g>
    </Ill>
  );
}

/** Verifying: an envelope with a ring going round it. */
export function VerifyingArt() {
  return (
    <Ill>
      <circle cx="100" cy="72" r="58" className={s.fBiruMuda} />
      <circle
        cx="100"
        cy="72"
        r="46"
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="70 220"
        className={cx('orbit2', 'sBiru')}
      />
      <path d="M72 56h56v34a6 6 0 0 1-6 6H78a6 6 0 0 1-6-6z" className={s.fBiru} />
      <path d="M72 58l28 18 28-18" fill="none" strokeWidth="3" strokeLinejoin="round" className={s.sBiruLembut} />
    </Ill>
  );
}

/** Expired: an hourglass that keeps turning over. */
export function HourglassArt() {
  return (
    <Ill>
      <circle cx="100" cy="72" r="58" className={s.fAmberMuda} />
      <g className={s.flipg}>
        <path d="M78 30h44M78 114h44" strokeWidth="7" strokeLinecap="round" className={s.sAmber} />
        <path
          d="M82 34c0 22 36 22 36 38s-36 16-36 38M118 34c0 22-36 22-36 38s36 16 36 38"
          fill="none"
          strokeWidth="4"
          className={s.sAmber}
        />
        <path d="M90 44h20l-10 14z" className={s.fKuning} />
        <path d="M88 108h24l-12-12z" className={s.fKuning} />
      </g>
    </Ill>
  );
}

/** Error: a plug pulled out of its socket. */
export function UnpluggedArt() {
  return (
    <Ill>
      <circle cx="100" cy="72" r="58" className={s.fMerahMuda} />
      <path d="M20 72h44" strokeWidth="6" strokeLinecap="round" className={s.sInk} />
      <g className={s.plugL}>
        <rect x="60" y="56" width="26" height="32" rx="6" className={s.fInk} />
        <path d="M86 64h10M86 80h10" strokeWidth="5" strokeLinecap="round" className={s.sInk} />
      </g>
      <g>
        <rect x="114" y="54" width="28" height="36" rx="6" className={s.fMerah} />
        <path d="M142 72h38" strokeWidth="6" strokeLinecap="round" className={s.sMerah} />
        <path d="M114 64h-6M114 80h-6" strokeWidth="5" strokeLinecap="round" className={s.sMerah} />
      </g>
      <path
        d="M100 40l-6 14h10l-6 14"
        fill="none"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cx('zap', 'sKuning')}
      />
    </Ill>
  );
}
