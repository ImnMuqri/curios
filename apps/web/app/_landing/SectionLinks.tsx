"use client";

import { useEffect, useRef, useState } from "react";
import { scrollToSection } from "./SmoothScroll.js";
import styles from "./header.module.css";

type Section = { href: "#how" | "#pricing" | "#faq"; label: string };

/**
 * The header's in-page links, with the one for the section you are reading
 * marked (aria-current="location", and a pill under it). Also marks the nav
 * bar `data-scrolled` once the page has moved, so it can take a hairline edge -- the same DOM-attribute seam `Ask` uses on
 * BentoPage, so the header itself can stay a server component.
 */
export function SectionLinks({
  sections,
  label,
}: {
  sections: Section[];
  label: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    const pill = nav.current?.closest<HTMLElement>("[data-pill]");
    const onScroll = () => {
      if (pill) pill.dataset.scrolled = window.scrollY > 8 ? "true" : "false";
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    if (!("IntersectionObserver" in window))
      return () => window.removeEventListener("scroll", onScroll);

    // A section counts as "being read" while it crosses the middle of the screen.
    const targets = sections
      .map((s) => document.querySelector(s.href))
      .filter((el): el is Element => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(`#${entry.target.id}`);
          else
            setActive((current) =>
              current === `#${entry.target.id}` ? null : current,
            );
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [sections]);

  return (
    <nav ref={nav} className={styles.sections} aria-label={label}>
      {sections.map((section) => (
        <a
          key={section.href}
          href={section.href}
          className={styles.link}
          onClick={(event) => {
            event.preventDefault();
            scrollToSection(section.href);
            history.replaceState(null, "", section.href);
          }}
          aria-current={active === section.href ? "location" : undefined}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
