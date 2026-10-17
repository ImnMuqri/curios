import type { PersonaKey } from './copy.js';

/**
 * The sample owners the landing shows, from the TanyaJe board. None of them
 * is real (the footer says so). What they say lives in copy.ts, per language;
 * this is how their pages look: the owner's accent, the deep colour their
 * page sits on, the tint their page's answers wear, and their heading font.
 */
export interface Persona {
  key: PersonaKey;
  name: string;
  /** How the ask bar names them: "Ask Daniel anything". */
  short: string;
  handle: string;
  kind: 'personal' | 'business' | 'creator';
  accent: string;
  deep: string;
  warm: string;
  font: string;
  /**
   * A photo for the top of their page, fading into `deep`, and the point of it
   * to keep in frame. Left out, the card is drawn in the owner's colours alone.
   * Photos live in public/landing/personas/ (see the README).
   */
  photo?: { src: string; focus: string };
  /** A square head-and-shoulders, for where the page needs a small round face. */
  face?: string;
}

const BRICOLAGE = 'var(--font-bricolage)';

export const PERSONAS: Record<PersonaKey, Persona> = {
  aisyah: { key: 'aisyah', name: 'Aisyah', short: 'Aisyah', handle: 'aisyahdraws', kind: 'personal', accent: '#1d6f5f', deep: '#123b33', warm: '#d3e8e1', font: BRICOLAGE, photo: { src: '/landing/personas/aisyah.webp', focus: '50% 32%' }, face: '/landing/personas/aisyah-face.webp' },
  lina: { key: 'lina', name: 'Kek Lina', short: 'Kek Lina', handle: 'keklina', kind: 'business', accent: '#b5294e', deep: '#3d0f1e', warm: '#f3dde3', font: 'var(--font-fraunces)', photo: { src: '/landing/hero-baker.webp', focus: '62% 22%' } },
  hana: { key: 'hana', name: 'Studio Hana', short: 'Studio Hana', handle: 'studiohana', kind: 'business', accent: '#c58a12', deep: '#2b2209', warm: '#f6e7c3', font: BRICOLAGE, photo: { src: '/landing/personas/hana.webp', focus: '50% 38%' } },
  daniel: { key: 'daniel', name: 'Daniel Tan', short: 'Daniel', handle: 'danieltan', kind: 'personal', accent: '#8a5a2b', deep: '#2a1a0e', warm: '#efe0cf', font: BRICOLAGE, photo: { src: '/landing/personas/daniel.webp', focus: '50% 30%' } },
  aina: { key: 'aina', name: 'Klinik Aina', short: 'Klinik Aina', handle: 'klinikaina', kind: 'business', accent: '#2340c8', deep: '#0f1b4d', warm: '#d6e1fd', font: BRICOLAGE, photo: { src: '/landing/personas/aina.webp', focus: '50% 45%' } },
  farah: { key: 'farah', name: 'Coach Farah', short: 'Farah', handle: 'coachfarah', kind: 'creator', accent: '#c2410c', deep: '#3a1405', warm: '#f8dcc9', font: BRICOLAGE, photo: { src: '/landing/personas/farah.webp', focus: '45% 30%' } },
};

/** The hero deck's order, front card first. */
export const DECK: PersonaKey[] = ['aisyah', 'lina', 'hana', 'daniel', 'aina'];
