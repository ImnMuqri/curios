'use client';

import type { ShopCopy } from '../../shop/copy.js';
import { useCopied } from './pay-box.js';
import styles from './order.module.css';

/** The API's public address: the download and link routes live there, keyed by the order's token. */
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** What the customer may see of a digital line. Codes, places and files arrive only once paid. */
export interface DigitalLineView {
  id: string;
  name: string;
  delivery: 'FILES' | 'LINK' | 'CODES' | 'SESSION';
  note: string | null;
  hasLink: boolean;
  minutes: number | null;
  place: 'ONLINE' | 'IN_PERSON' | null;
  where: string | null;
  /** ISO. */
  startsAt: string | null;
  codes: string[];
  files: { id: string; name: string; sizeBytes: number | null; usesLeft: number; expiresAt: string }[];
}

const sizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);
const extension = (name: string) => (name.includes('.') ? name.split('.').pop()!.slice(0, 4) : '');

function CodeRow({ code, copy }: { code: string; copy: ShopCopy }) {
  const [copied, copyText] = useCopied();
  return (
    <div className={styles.dgCode}>
      <code>{code}</code>
      <button type="button" onClick={() => copyText(code)}>
        {copied ? copy.copied : copy.copyShort}
      </button>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
    </svg>
  );
}

/**
 * "Your downloads and access" (Public board, `order`): what a paid order hands
 * over, line by line. Everything here comes from what was sold. The buttons are
 * plain links to the API's routes, so each download is counted there.
 */
export function DigitalSection(props: {
  lines: DigitalLineView[];
  token: string;
  handle: string;
  name: string;
  email: string | null;
  copy: ShopCopy;
  /** The server's clock (ISO), for what has expired. */
  now: string;
  /** The shop's page is suspended: the API refuses downloads and links, so no buttons. */
  paused: boolean;
  onlyFiles: boolean;
}) {
  const { copy, name } = props;
  const now = new Date(props.now).getTime();
  const token = encodeURIComponent(props.token);
  return (
    <section id="downloads" className={styles.downloads} aria-labelledby="order-downloads">
      <div className={styles.dgHead}>
        <h2 id="order-downloads">{copy.dgTitle(props.onlyFiles)}</h2>
        {props.email ? <span>{copy.alsoSentTo(props.email)}</span> : null}
      </div>
      {props.paused ? <p className={styles.dgSmall}>{copy.pausedDownloads(name)}</p> : null}
      {props.lines.map((line) => {
        const waiting = (line.delivery === 'FILES' && line.files.length === 0) || (line.delivery === 'CODES' && line.codes.length === 0);
        const dead = line.files.filter((f) => f.usesLeft <= 0 || new Date(f.expiresAt).getTime() <= now);
        const latest = line.files.reduce<string | null>((max, f) => (max === null || f.expiresAt > max ? f.expiresAt : max), null);
        const startsAt = line.startsAt;
        const joinUrl = !props.paused && line.place === 'ONLINE' && line.where?.startsWith('https://') ? line.where : null;
        return (
          <div key={line.id} className={styles.dg} data-delivery={line.delivery}>
            <p className={styles.dgName}>{line.name}</p>
            {waiting ? <p className={styles.dgSmall}>{copy.sendingNow}</p> : null}
            {line.delivery === 'FILES' && line.files.length > 0 ? (
              <>
                {line.files.map((file) => {
                  const expired = new Date(file.expiresAt).getTime() <= now;
                  const usedUp = !expired && file.usesLeft <= 0;
                  const left = expired ? copy.expired : usedUp ? copy.usedUp : copy.downloadsLeft(file.usesLeft);
                  return (
                    <div key={file.id} className={styles.dgFile} data-dead={expired || usedUp ? '' : undefined}>
                      <span className={styles.dgExt} aria-hidden="true">
                        {extension(file.name)}
                      </span>
                      <span className={styles.dgFileName}>
                        <b>{file.name}</b>
                        <small>{[file.sizeBytes === null ? null : sizeText(file.sizeBytes), left].filter(Boolean).join(' · ')}</small>
                      </span>
                      {expired || usedUp || props.paused ? null : (
                        <a className={styles.dgButton} href={`${API}/store/orders/${token}/files/${encodeURIComponent(file.id)}`}>
                          <DownloadIcon />
                          {copy.download}
                        </a>
                      )}
                    </div>
                  );
                })}
                <p className={styles.dgSmall}>{dead.length > 0 ? copy.linksSomeDead(name) : latest ? copy.linksUntil(copy.shortDate(latest), name) : null}</p>
              </>
            ) : null}
            {line.delivery === 'LINK' ? (
              <>
                {line.note ? (
                  <p className={styles.dgNote}>
                    “{line.note}” · {name}
                  </p>
                ) : null}
                {line.hasLink && !props.paused ? (
                  <a className={`${styles.dgButton} ${styles.dgWide}`} href={`${API}/store/orders/${token}/link/${encodeURIComponent(line.id)}`} target="_blank" rel="noopener noreferrer">
                    {copy.openLink}
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
                    </svg>
                  </a>
                ) : null}
                <p className={styles.dgSmall}>{copy.linkPrivate}</p>
              </>
            ) : null}
            {line.delivery === 'CODES' && line.codes.length > 0 ? (
              <>
                {line.codes.map((code) => (
                  <CodeRow key={code} code={code} copy={copy} />
                ))}
                <p className={styles.dgSmall}>{copy.codeNote(name)}</p>
              </>
            ) : null}
            {line.delivery === 'SESSION' && startsAt ? (
              <>
                <p className={styles.dgWhen}>
                  <b>{copy.sessionTime(startsAt)}</b>
                  <span>
                    {[line.minutes ? copy.minutesLong(line.minutes) : null, line.place === 'IN_PERSON' ? copy.inPerson(line.where) : copy.online].filter(Boolean).join(' · ')}
                  </span>
                </p>
                <span className={styles.dgRow}>
                  {joinUrl ? (
                    <a className={styles.dgButton} href={joinUrl} target="_blank" rel="noopener noreferrer">
                      {copy.joinClass}
                    </a>
                  ) : null}
                  <a className={`${styles.dgButton} ${joinUrl ? styles.dgGhost : ''}`} href={`/${props.handle}/order/${token}/calendar?line=${encodeURIComponent(line.id)}`}>
                    {copy.addToCalendar}
                  </a>
                </span>
                <p className={styles.dgSmall}>{copy.sessionNote}</p>
              </>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
