import { useId } from 'react';
import styles from './scene.module.css';

/** The sign-in answers, verbatim from the SignIn board (owner answer 6: sample counts, since there is no session before login). */
const POPS: { text: string; tag: string; green?: boolean; delay: string }[] = [
  { text: 'Boleh hantar ke Klang?', tag: 'Answered', delay: '0ms' },
  { text: 'Ada kek tanpa telur?', tag: 'Answered', delay: '1300ms' },
  { text: 'Nak order 2kg untuk Sabtu', tag: 'Number saved', green: true, delay: '2600ms' },
];

/** The sign's text is sized to fit the sign: the board's 15.5 for a short name, smaller for a long one. */
function handleSize(handle: string): number {
  return Math.max(8, Math.min(15.5, 100 / (handle.length * 0.58)));
}

/**
 * Beside the sign-in and sign-up forms: Peek, full-body and calm, on a tinted
 * panel (design/HANDOFF.md, "Sign in and sign up, right panel"; SignIn.dc.html
 * and SignUp.dc.html). Sign in: Peek with a phone while sample answers pop up,
 * "While you were away". Sign up: Peek holding a sign with the wanted address.
 * Decoration, hidden from assistive tech. Wide screens only.
 */
export function AuthScene({ scene, handle = '' }: { scene: 'signin' | 'signup'; handle?: string }) {
  const clipId = `pa-clip-${useId().replace(/:/g, '')}`;
  const signIn = scene === 'signin';
  const name = handle || 'yourname';

  return (
    <aside className={`${styles.art} ${signIn ? styles.signin : styles.signup}`} aria-hidden="true">
      <div className={styles.pa}>
        <div className={`${styles.stage} ${signIn ? '' : styles.stageUp}`}>
          {signIn ? (
            <div className={styles.pops}>
              {POPS.map((pop) => (
                <span key={pop.text} style={{ animationDelay: pop.delay }}>
                  <b>{pop.text}</b>
                  <i className={pop.green ? styles.green : undefined}>{pop.tag}</i>
                </span>
              ))}
            </div>
          ) : null}
          <svg className={styles.svg} viewBox={signIn ? '-10 -6 180 156' : '-10 -32 180 182'}>
            <defs>
              <clipPath id={clipId}>
                <ellipse cx="80" cy="84" rx="54" ry="49" />
              </clipPath>
            </defs>
            <ellipse cx="80" cy="143" rx="44" ry="4.5" className={styles.shadow} />
            <ellipse cx="63" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
            <ellipse cx="97" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
            <g className={styles.bob}>
              <g clipPath={`url(#${clipId})`}>
                <rect x="20" y="30" width="120" height="110" fill="var(--peek-shade)" />
                <ellipse cx="73" cy="76" rx="54" ry="48" fill="var(--peek-body)" />
              </g>
              <ellipse cx="55" cy="54" rx="9" ry="5" fill="var(--peek-shine)" transform="rotate(-30 55 54)" />
              <g className={styles.eyes}>
                <ellipse cx="66" cy="82" rx="11.5" ry="13.5" fill="var(--card)" />
                <ellipse cx="95" cy="82" rx="11.5" ry="13.5" fill="var(--card)" />
                <circle cx={signIn ? 70 : 67} cy={signIn ? 88 : 81} r="6.6" fill="var(--ink)" />
                <circle cx={signIn ? 99 : 96} cy={signIn ? 88 : 81} r="6.6" fill="var(--ink)" />
                <circle cx={signIn ? 72.2 : 69.2} cy={signIn ? 85 : 78} r="2.1" fill="var(--card)" />
                <circle cx={signIn ? 101.2 : 98.2} cy={signIn ? 85 : 78} r="2.1" fill="var(--card)" />
              </g>
              <path d="M75 104q5.5 4.5 11 0" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
            </g>
            {signIn ? (
              <>
                <g data-peek-phone="" transform="rotate(14 120 112)">
                  <rect x="106" y="90" width="30" height="46" rx="6" fill="var(--ink)" />
                  <rect x="109" y="95" width="24" height="36" rx="3" fill="var(--paper)" />
                  <rect x="112" y="99" width="14" height="5" rx="2.5" fill="var(--biru-ring)" />
                  <rect x="116" y="107" width="14" height="5" rx="2.5" fill="var(--biru)" />
                  <rect x="112" y="115" width="11" height="5" rx="2.5" fill="var(--biru-ring)" />
                  <rect x="116" y="123" width="14" height="5" rx="2.5" fill="var(--biru)" />
                </g>
                <g className={styles.tap}>
                  <circle cx="105" cy="124" r="9.5" fill="var(--peek-hand)" stroke="var(--peek-edge)" strokeWidth="1.5" />
                </g>
                <circle cx="139" cy="104" r="9.5" fill="var(--peek-hand)" stroke="var(--peek-edge)" strokeWidth="1.5" />
              </>
            ) : (
              <g className={styles.sign}>
                <rect x="6" y="-24" width="148" height="50" rx="12" fill="var(--card)" stroke="var(--ink)" strokeWidth="2" />
                <text x="22" y="-3" className={styles.signMono} fontSize="10" fill="var(--muted)">
                  curios.my/
                </text>
                <text
                  x="22"
                  y="15"
                  className={styles.signName}
                  fontSize={handleSize(name)}
                  fontWeight="700"
                  fill="var(--ink)"
                  letterSpacing="-.3"
                >
                  {name}
                </text>
                {handle ? (
                  <g data-peek-tick="" className={styles.tick}>
                    <circle cx="136" cy="-7" r="9" fill="var(--hijau)" />
                    <path d="M131.5 -7l3 3 6-6" fill="none" stroke="var(--card)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                ) : null}
                <circle cx="12" cy="20" r="9.5" fill="var(--peek-hand)" stroke="var(--peek-edge)" strokeWidth="1.5" />
                <circle cx="148" cy="20" r="9.5" fill="var(--peek-hand)" stroke="var(--peek-edge)" strokeWidth="1.5" />
              </g>
            )}
          </svg>
        </div>
        <p className={styles.cap}>
          {signIn ? (
            <>
              <b>While you were away</b>
              <span>Your page answered 12 questions and saved 2 numbers.</span>
            </>
          ) : (
            <>
              <b>We’ll save this name for you</b>
              <span>Finish signing up to claim curios.my/{name}.</span>
            </>
          )}
        </p>
      </div>
    </aside>
  );
}
