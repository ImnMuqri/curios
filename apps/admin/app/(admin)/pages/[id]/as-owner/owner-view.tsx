import Link from 'next/link';
import type { OwnerView as OwnerViewData } from '@curios/db-read/admin';
import { dayTime, day, rm } from '../../format.js';
import styles from './owner-view.module.css';

/** Everything here is already masked by the read; this only lays it out. No controls that change anything. */
export function OwnerView({ view, pageId }: { view: OwnerViewData; pageId: string }) {
  const { profile, plan, facts, items, leads, orders, conversations } = view;

  return (
    <>
      <div className={styles.banner} role="note">
        <span>
          Viewing {profile.displayName} as the owner · read only
        </span>
        <Link href={`/pages?page=${encodeURIComponent(pageId)}`}>Back to Pages</Link>
      </div>

      <div className={styles.body}>
        <section className={styles.sec} aria-labelledby="ov-profile">
          <h2 id="ov-profile">Profile and links</h2>
          <div className={styles.box}>
            <dl className={styles.kv}>
              <dt>Name</dt>
              <dd>{profile.displayName}</dd>
              <dt>Page</dt>
              <dd>curios.my/{profile.handle}</dd>
              <dt>Kind</dt>
              <dd>{profile.mode === 'BUSINESS' ? 'Business' : 'Personal'}</dd>
              <dt>Language</dt>
              <dd>{profile.language}</dd>
              <dt>Published</dt>
              <dd>{profile.published ? 'Yes' : 'No'}</dd>
              <dt>Bio</dt>
              <dd>{profile.bio ?? '-'}</dd>
            </dl>
            {profile.links.length > 0 && (
              <ul className={styles.list}>
                {profile.links.map((l, i) => (
                  <li key={`${l.url}-${i}`}>
                    <b>{l.label}</b>
                    <span>{l.url}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className={styles.sec} aria-labelledby="ov-plan">
          <h2 id="ov-plan">Plan and usage</h2>
          <div className={styles.box}>
            <dl className={styles.kv}>
              <dt>Plan</dt>
              <dd>{plan.plan}</dd>
              <dt>Paid until</dt>
              <dd>{plan.paidUntil ? day(plan.paidUntil) : '-'}</dd>
              <dt>Conversations</dt>
              <dd>
                {plan.conversationsThisMonth} of {plan.cap} this month
              </dd>
              <dt>Leads</dt>
              <dd>{plan.leadsThisMonth} this month</dd>
              <dt>Orders</dt>
              <dd>{plan.ordersThisMonth} this month</dd>
            </dl>
          </div>
        </section>

        <section className={styles.sec} aria-labelledby="ov-facts">
          <h2 id="ov-facts">Facts</h2>
          <div className={styles.box}>
            {facts.length === 0 ? (
              <p className={styles.none}>No facts yet.</p>
            ) : (
              <ul className={styles.list}>
                {facts.map((f, i) => (
                  <li key={i}>
                    <span>{f.text}</span>
                    <em>{f.status}</em>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className={styles.sec} aria-labelledby="ov-items">
          <h2 id="ov-items">Items</h2>
          <div className={styles.box}>
            {items.length === 0 ? (
              <p className={styles.none}>No items.</p>
            ) : (
              <ul className={styles.list}>
                {items.map((it, i) => (
                  <li key={i}>
                    <b>{it.name}</b>
                    <span>
                      {it.priceCents === null ? '-' : rm(it.priceCents)}
                      {it.available ? '' : ' · unavailable'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className={styles.sec} aria-labelledby="ov-leads">
          <h2 id="ov-leads">Leads</h2>
          <div className={styles.box}>
            {leads.length === 0 ? (
              <p className={styles.none}>No leads.</p>
            ) : (
              <ul className={styles.list}>
                {leads.map((l, i) => (
                  <li key={i}>
                    <b>{l.maskedPhone}</b>
                    <span>
                      {dayTime(l.createdAt)}
                      {l.slotsFilled.length > 0 ? ` · ${l.slotsFilled.join(', ')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className={styles.sec} aria-labelledby="ov-orders">
          <h2 id="ov-orders">Orders</h2>
          <div className={styles.box}>
            {orders.length === 0 ? (
              <p className={styles.none}>No orders.</p>
            ) : (
              <ul className={styles.list}>
                {orders.map((o) => (
                  <li key={o.number}>
                    <b>
                      #{o.number} · {o.maskedName}
                    </b>
                    <span>
                      {rm(o.totalCents)} · {o.status} · {dayTime(o.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className={styles.sec} aria-labelledby="ov-chats">
          <h2 id="ov-chats">Conversations</h2>
          <div className={styles.box}>
            <p className={styles.line}>
              <b>{conversations.thisMonth}</b> this month. What was said is not shown here.
            </p>
            {conversations.latest.length > 0 && (
              <ul className={styles.list}>
                {conversations.latest.map((t, i) => (
                  <li key={i}>
                    <span>{dayTime(t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
