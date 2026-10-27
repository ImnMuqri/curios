import { describe, expect, it } from 'vitest';
import { pageRestoredMail, pageSuspendedMail, reportWarningMail } from './admin-mail.js';

const base = { displayName: 'Kek Lina', reason: 'Sells <b>fake</b> goods & more', appUrl: 'https://curios.my/' };

describe('the admin emails', () => {
  it('suspended: subject, the reason verbatim in the text, escaped in the html', () => {
    const mail = pageSuspendedMail(base);
    expect(mail.subject).toBe('Your page has been suspended');
    expect(mail.text).toContain(`Reason: ${base.reason}`);
    expect(mail.html).toContain('Sells &lt;b&gt;fake&lt;/b&gt; goods &amp; more');
    expect(mail.html).toContain('href="https://curios.my/app"');
  });

  it('suspended in Malay when the page is', () => {
    const mail = pageSuspendedMail({ ...base, language: 'ms' });
    expect(mail.subject).toBe('Halaman anda telah digantung');
    expect(mail.text).toContain(`Sebab: ${base.reason}`);
  });

  it('restored: subject and the reason verbatim', () => {
    const mail = pageRestoredMail({ ...base, reason: 'Checked, all fine' });
    expect(mail.subject).toBe('Your page is back');
    expect(mail.text).toContain('Note: Checked, all fine');
    expect(mail.html).toContain('Checked, all fine');
  });

  it('restored in Malay when the page is', () => {
    const mail = pageRestoredMail({ ...base, language: 'ms' });
    expect(mail.subject).toBe('Halaman anda kembali');
  });

  it('report warning: subject, the reason verbatim, escaped in the html', () => {
    const mail = reportWarningMail(base);
    expect(mail.subject).toBe('About your page on Curios');
    expect(mail.text).toContain(base.reason);
    expect(mail.html).toContain('Sells &lt;b&gt;fake&lt;/b&gt; goods &amp; more');
    expect(mail.html).toContain('href="https://curios.my/app"');
  });

  it('report warning in Malay when the page is', () => {
    const mail = reportWarningMail({ ...base, language: 'ms' });
    expect(mail.subject).toBe('Tentang halaman anda di Curios');
    expect(mail.text).toContain(base.reason);
  });

  it('report warning in Malay says the whole body in Malay, and none of it in English', () => {
    const mail = reportWarningMail({ ...base, language: 'ms' });
    expect(mail.text).toBe(
      [
        'Pasukan Curios menerima laporan tentang Kek Lina dan meminta anda menyemaknya. Halaman anda masih kelihatan kepada pengunjung.',
        '',
        `Daripada pasukan kami: ${base.reason}`,
        '',
        'Ada soalan? Balas emel ini dan kami akan membantu.',
        '',
        'https://curios.my/app',
      ].join('\n'),
    );
    expect(mail.html).toContain('Perlu disemak');
    expect(mail.html).toContain('Buka papan pemuka');
    expect(mail.html).toContain('Daripada pasukan kami: Sells &lt;b&gt;fake&lt;/b&gt; goods &amp; more');
    for (const english of ['Please review', 'Open your dashboard', 'From our team', 'Questions?', 'Your page stays live']) {
      expect(mail.html).not.toContain(english);
      expect(mail.text).not.toContain(english);
    }
  });
});
