import Link from 'next/link';
import { REPORT_REASONS } from '@curios/core/report';
import type { Overview as OverviewData, Period } from '@curios/db-read/admin';
import { PERIODS } from './period.js';
import styles from './overview.module.css';

const int = (n: number) => n.toLocaleString('en-US');
const rm = (cents: number) => `RM${int(Math.round(cents / 100))}`;
// The gateway counts AI cost in thousandths of a US cent: 100,000 to the dollar.
const usd = (milliCents: number, decimals: number) => `US$${(milliCents / 100_000).toFixed(decimals)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
/** "23 Oct 2026", on the Malaysian calendar. */
function day(d: Date): string {
  const [y, m, n] = ymd.format(d).split('-').map(Number) as [number, number, number];
  return `${n} ${MONTHS[m - 1]} ${y}`;
}

interface Stat {
  value: string;
  label: string;
  note: string;
  tone: 'good' | 'soft';
}

function stats(o: OverviewData, phrase: string, period: Period): Stat[] {
  const { answered, conversations, aiCost } = o;
  let change = '';
  let changeTone: Stat['tone'] = 'soft';
  if (conversations.previous > 0) {
    const pct = Math.round(((conversations.count - conversations.previous) / conversations.previous) * 100);
    change = `${pct >= 0 ? '+' : ''}${pct}% on the period before`;
    changeTone = pct >= 0 ? 'good' : 'soft';
  }
  const pctAnswered = answered.recorded === 0 ? null : Math.round((answered.answered / answered.recorded) * 100);

  return [
    {
      value: int(o.livePages.count),
      label: 'Live pages',
      note: `+${int(o.livePages.newInPeriod)} ${period === 'today' ? 'today' : 'this period'}`,
      tone: 'good',
    },
    { value: int(o.paying.count), label: 'Paying for Business', note: `+${int(o.paying.newInPeriod)} new`, tone: 'good' },
    { value: rm(o.revenueCents), label: `Business revenue, ${phrase}`, note: '', tone: 'soft' },
    { value: int(conversations.count), label: `Conversations, ${phrase}`, note: change, tone: changeTone },
    {
      value: pctAnswered === null ? '—' : `${pctAnswered}%`,
      label: 'Answered from facts',
      note: pctAnswered === null ? '' : `${100 - pctAnswered}% got “I’m not sure”`,
      tone: 'soft',
    },
    {
      value: usd(aiCost.milliCents, 2),
      label: `AI cost, ${phrase}`,
      note: conversations.count > 0 ? `${usd(aiCost.perConversationMilliCents, 3)} a conversation` : '',
      tone: 'soft',
    },
  ];
}

interface Need {
  key: string;
  count: number;
  dot: 'warn' | 'quiet';
  title: string;
  sub: string;
  href?: string;
  button?: string;
}

function needs(o: OverviewData, cap: number): Need[] {
  const { failedReads, atCap, plansEnding, reported } = o.needsYou;
  const out: Need[] = [];
  if (reported.pages > 0) {
    const top = reported.top;
    out.push({
      key: 'reported',
      count: reported.pages,
      dot: 'warn',
      title: `${reported.pages} ${reported.pages === 1 ? 'page' : 'pages'} reported`,
      sub: top
        ? `${top.displayName} has ${top.count} ${REPORT_REASONS[top.reason].en.toLowerCase()} ${top.today ? 'reports today' : 'open reports'}`
        : '',
      href: '/reports',
      button: 'Look',
    });
  }
  if (failedReads > 0) {
    out.push({
      key: 'failed',
      count: failedReads,
      dot: 'warn',
      title: `${failedReads} ${failedReads === 1 ? 'source' : 'sources'} couldn’t be read`,
      sub: 'In the last 7 days',
    });
  }
  if (atCap.count > 0) {
    const names = atCap.names.join(' and ');
    out.push({
      key: 'cap',
      count: atCap.count,
      dot: 'warn',
      title: `${atCap.count} ${atCap.count === 1 ? 'page hit' : 'pages hit'} the ${cap} limit`,
      sub: names ? (atCap.count > atCap.names.length ? `${names} among them` : names) : 'This month',
      href: atCap.count === 1 && atCap.names[0] ? `/pages?q=${encodeURIComponent(atCap.names[0])}` : '/pages',
      button: 'See pages',
    });
  }
  if (plansEnding > 0) {
    out.push({
      key: 'ending',
      count: plansEnding,
      dot: 'quiet',
      title: `${plansEnding} Business ${plansEnding === 1 ? 'plan ends' : 'plans end'} this week`,
      sub: 'Owners get a reminder 3 days before',
      href: '/pages?filter=business',
      button: 'See pages',
    });
  }
  return out;
}

export function Overview({ overview: o, period, cap }: { overview: OverviewData; period: Period; cap: number }) {
  const phrase = PERIODS.find((p) => p.key === period)?.phrase ?? '';
  const open = needs(o, cap);
  const openCount = open.reduce((n, item) => n + item.count, 0);
  const max = Math.max(0, ...o.perDay.map((d) => d.count));
  const total = o.byKind.personal + o.byKind.business;
  const share = (n: number) => (total === 0 ? 0 : (n / total) * 100);

  return (
    <>
      <div className={styles.head}>
        <h1>Overview</h1>
        <p>How Curios is doing</p>
        <nav className={styles.per} aria-label="Period">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={p.key === '7d' ? '/' : `/?period=${p.key}`}
              aria-current={p.key === period ? 'true' : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className={styles.body}>
        <div className={styles.stats}>
          {stats(o, phrase, period).map((s) => (
            <div key={s.label} className={styles.stat}>
              <b>{s.value}</b>
              <span>{s.label}</span>
              <small className={s.tone === 'good' ? styles.good : styles.soft}>{s.note}</small>
            </div>
          ))}
        </div>

        <div className={styles.grid}>
          <div className={styles.sec}>
            <h2 className={styles.h2}>
              Conversations a day<span>Last {o.perDay.length} days</span>
            </h2>
            <div className={`${styles.box} ${styles.chart}`}>
              <div className={styles.bars} role="img" aria-label="Conversations per day">
                {o.perDay.map((d, i) => (
                  <span
                    key={d.day}
                    className={i === o.perDay.length - 1 ? styles.on : styles.bar}
                    style={{ height: `${max === 0 ? 0 : Math.round((d.count / max) * 100)}%` }}
                    title={`${d.day}: ${int(d.count)}`}
                  />
                ))}
              </div>
              <div className={styles.axis}>
                <span>{o.perDay.length - 1} days ago</span>
                <span>Today</span>
              </div>
              <div className={styles.key}>
                <span>
                  <i className={styles.keyOn} />
                  Today
                </span>
                <span>
                  <i className={styles.keyEarlier} />
                  Earlier days
                </span>
              </div>
            </div>

            <h2 className={`${styles.h2} ${styles.again}`}>
              New pages<span>Newest first</span>
            </h2>
            <div className={`${styles.box} ${styles.tw}`}>
              <div className={styles.t} role="table" aria-label="New pages">
                <div className={`${styles.r} ${styles.hd}`} role="row">
                  {['Page', 'Kind', 'Signed up', 'Facts', 'First question'].map((h, i) => (
                    <div key={h} className={i === 3 ? `${styles.h} ${styles.right}` : styles.h} role="columnheader">
                      {h}
                    </div>
                  ))}
                </div>
                {o.newPages.length === 0 && (
                  <div className={styles.r} role="row">
                    <div className={styles.empty} role="cell">
                      No pages yet.
                    </div>
                  </div>
                )}
                {o.newPages.map((p) => (
                  <div key={p.handle} className={styles.r} role="row">
                    <div className={styles.c} role="cell">
                      <Link className={styles.pg} href={`/pages?q=${encodeURIComponent(p.handle)}`}>
                        <b>{p.name}</b>
                        <code>curios.my/{p.handle}</code>
                      </Link>
                    </div>
                    <div className={styles.c} role="cell">
                      {p.mode === 'BUSINESS' ? 'Business' : 'Personal'}
                    </div>
                    <div className={styles.c} role="cell">
                      {day(p.createdAt)}
                    </div>
                    <div className={`${styles.c} ${styles.right}`} role="cell">
                      {int(p.factCount)}
                    </div>
                    <div className={styles.c} role="cell">
                      {p.hasConversation ? 'Yes' : 'Not yet'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.sec}>
            <h2 className={styles.h2}>
              Needs you<span>{int(openCount)} open</span>
            </h2>
            <div className={styles.box}>
              {open.length === 0 && <p className={styles.nothing}>Nothing needs you.</p>}
              {open.map((n) => (
                <div key={n.key} className={styles.need}>
                  <i className={styles[n.dot]} />
                  <span>
                    <b>{n.title}</b>
                    <small>{n.sub}</small>
                  </span>
                  {n.href && (
                    <Link className={styles.btn} href={n.href}>
                      {n.button}
                    </Link>
                  )}
                </div>
              ))}
            </div>

            <h2 className={`${styles.h2} ${styles.again}`}>
              Pages by kind<span>{int(total)} live</span>
            </h2>
            <div className={`${styles.box} ${styles.mix}`}>
              <div className={styles.split}>
                <i className={styles.personal} style={{ width: `${share(o.byKind.personal)}%` }} />
                <i className={styles.business} style={{ width: `${share(o.byKind.business)}%` }} />
              </div>
              <div className={styles.legend}>
                <span>
                  <i className={styles.personal} />
                  Personal
                  <b>{int(o.byKind.personal)}</b>
                </span>
                <span>
                  <i className={styles.business} />
                  Business
                  <b>{int(o.byKind.business)}</b>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
