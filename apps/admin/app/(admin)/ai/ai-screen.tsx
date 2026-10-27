import type { CSSProperties } from 'react';
import Link from 'next/link';
import type { AiJob, AiUsage, Period } from '@curios/db-read/admin';
import { ago } from '../ago.js';
import { meterColour } from '../pages/format.js';
import { PERIODS } from '../period.js';
import styles from './ai.module.css';

const int = (n: number) => n.toLocaleString('en-US');
// The gateway counts AI cost in thousandths of a US cent: 100,000 to the dollar.
const usd = (milliCents: number, decimals: number) => `US$${(milliCents / 100_000).toFixed(decimals)}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const JOB_LABEL: Record<AiJob, string> = {
  chat: 'Answering visitors',
  reading: 'Reading sources into facts',
  grouping: 'Grouping questions',
};

interface Stat {
  value: string;
  label: string;
  note: string;
  red?: boolean;
}

function stats(u: AiUsage): Stat[] {
  const { perConversation: cost, answerMs, unsure, failed } = u;
  let costNote = '';
  if (cost.milliCents > 0 && cost.previousMilliCents > 0 && cost.milliCents !== cost.previousMilliCents) {
    costNote = `${cost.milliCents < cost.previousMilliCents ? 'Down' : 'Up'} from ${usd(cost.previousMilliCents, 3)}`;
  }
  return [
    { value: int(u.calls), label: 'Model calls', note: '' },
    {
      value: answerMs ? seconds(answerMs.median) : '—',
      label: 'Typical answer time',
      note: answerMs ? `Slowest 5%: ${seconds(answerMs.p95)}` : '',
    },
    { value: cost.milliCents > 0 ? usd(cost.milliCents, 3) : '—', label: 'Cost a conversation', note: costNote },
    {
      value: unsure.recorded > 0 ? `${Math.round((unsure.notSure / unsure.recorded) * 100)}%` : '—',
      label: '“I’m not sure” replies',
      note: 'Questions with no fact to answer',
    },
    {
      value: u.calls > 0 ? `${(failed.share * 100).toFixed(1)}%` : '—',
      label: 'Calls that failed',
      note: 'Retried once, then the fixed reply',
    },
  ];
}

export function AiScreen({ usage: u, period, cap, now }: { usage: AiUsage; period: Period; cap: number; now: Date }) {
  const phrase = PERIODS.find((p) => p.key === period)?.phrase ?? '';

  return (
    <>
      <div className={styles.head}>
        <h1>AI &amp; usage</h1>
        <p>What the model does and what it costs</p>
        <nav className={styles.per} aria-label="Period">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={p.key === '7d' ? '/ai' : `/ai?period=${p.key}`}
              aria-current={p.key === period ? 'true' : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className={styles.body}>
        <div className={styles.stats}>
          {stats(u).map((s) => (
            <div key={s.label} className={styles.stat}>
              <b>{s.value}</b>
              <span>{s.label}</span>
              <small className={styles.soft}>{s.note}</small>
            </div>
          ))}
        </div>

        <div className={styles.grid}>
          <div className={styles.sec}>
            <h2 className={styles.h2}>
              What the AI costs<span>From model calls, {phrase}</span>
            </h2>
            <div className={`${styles.box} ${styles.tw}`}>
              <div
                className={styles.t}
                role="table"
                aria-label="What the AI costs"
                style={{ '--cols': 'minmax(180px,2fr) 80px 80px 70px 80px', '--minw': '520px' } as CSSProperties}
              >
                <div className={styles.r} role="row">
                  {['Job', 'Calls', 'Avg time', 'Failed', 'Cost'].map((h, i) => (
                    <div key={h} className={i === 0 ? styles.h : `${styles.h} ${styles.right}`} role="columnheader">
                      {h}
                    </div>
                  ))}
                </div>
                {u.jobs.map((j) => (
                  <div key={j.job} className={styles.r} role="row">
                    <div className={styles.c} role="cell">
                      <span className={styles.pg}>
                        <b>{JOB_LABEL[j.job]}</b>
                        <code>{j.model}</code>
                      </span>
                    </div>
                    <div className={`${styles.c} ${styles.right}`} role="cell">
                      {int(j.calls)}
                    </div>
                    <div className={`${styles.c} ${styles.right}`} role="cell">
                      {j.calls > 0 ? seconds(j.avgMs) : '—'}
                    </div>
                    <div className={`${styles.c} ${styles.right} ${j.failed > 0 ? styles.red : ''}`} role="cell">
                      {int(j.failed)}
                    </div>
                    <div className={`${styles.c} ${styles.right}`} role="cell">
                      <b>{j.calls > 0 ? usd(j.milliCents, 2) : '—'}</b>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <h2 className={`${styles.h2} ${styles.again}`}>
              “I’m not sure” answers<span>Where pages are missing facts</span>
            </h2>
            <div className={styles.box}>
              {u.unsureLatest.map((q, i) => (
                <div key={`${q.handle}-${q.askedAt.toISOString()}-${i}`} className={styles.tr}>
                  <p>{q.question}</p>
                  <small>
                    curios.my/{q.handle} · {ago(q.askedAt, now)}
                  </small>
                </div>
              ))}
              {u.unsureLatest.length === 0 && <p className={styles.nothing}>No “I’m not sure” answers yet.</p>}
            </div>
          </div>

          <div className={styles.sec}>
            <h2 className={styles.h2}>
              Near the monthly limit<span>{int(cap)} conversations</span>
            </h2>
            <div className={styles.box}>
              {u.nearCap.length > 0 && (
                <div className={styles.near}>
                  <div className={styles.h}>Page</div>
                  <div className={styles.h}>Used</div>
                </div>
              )}
              {u.nearCap.map((p) => (
                <Link key={p.pageId} className={styles.near} href={`/pages?page=${encodeURIComponent(p.pageId)}`}>
                  <div className={styles.c}>
                    <span className={styles.pg}>
                      <b>{p.displayName}</b>
                      <code>curios.my/{p.handle}</code>
                    </span>
                  </div>
                  <div className={styles.c}>
                    <span className={styles.mini}>
                      <span className={styles.bar}>
                        <i style={{ width: `${Math.min(100, (p.used / p.cap) * 100)}%`, background: meterColour(p.used, p.cap) }} />
                      </span>
                      <span className={styles.num}>
                        {int(p.used)} of {int(p.cap)}
                      </span>
                    </span>
                  </div>
                </Link>
              ))}
              {u.nearCap.length === 0 && <p className={styles.nothing}>Nothing near the limit.</p>}
            </div>
            <p className={styles.note}>
              A page at {int(cap)} gets the short fixed reply until the 1st. Nothing is charged.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
