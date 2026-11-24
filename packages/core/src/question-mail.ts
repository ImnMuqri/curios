import { OWNER_MAIL_FOOTER, renderMailHtml } from './mail.js';

/**
 * "A question is asked 3 times", the Dash board's Settings switch with the line "A sign it
 * needs your answer." The owner's, so the footer says where to switch it off (Page.notifyQuestions).
 * Sent once per topic, when it has three asks and no answer (Topic.askedMailedAt).
 */

/** How many asks make a question worth an email. */
export const QUESTION_MAIL_ASKS = 3;

interface Mail {
  subject: string;
  text: string;
  html: string;
}

/** The topic's title, cut to a length a subject line and a heading can carry. */
function short(title: string): string {
  const one = title.replace(/\s+/g, ' ').trim();
  return one.length > 80 ? `${one.slice(0, 79).trimEnd()}…` : one;
}

/** The topic's own screen in Questions: the button's destination. */
export const topicUrl = (appUrl: string, topicId: string) => `${appUrl.replace(/\/+$/, '')}/app/questions?topic=${encodeURIComponent(topicId)}`;

export function questionAskedMail(input: { title: string; asks: number; topicId: string; appUrl: string; displayName: string }): Mail {
  const title = short(input.title);
  const subject = `People keep asking: “${title}”`;
  const said = `It has been asked ${input.asks} times and it isn’t answered yet.`;
  const more = 'Write an answer once and your page uses it every time.';
  const url = topicUrl(input.appUrl, input.topicId);
  return {
    subject,
    text: [`“${title}”`, said, more, '', `Answer it: ${url}`].join('\n'),
    html: renderMailHtml({
      subject,
      appUrl: input.appUrl,
      topRight: input.displayName,
      tag: { label: 'Needs your answer', tone: 'biru' },
      heading: `People keep asking: “${title}”`,
      blocks: [
        { kind: 'p', text: said },
        { kind: 'p', text: more },
        { kind: 'buttons', primary: { label: 'Answer it', href: url } },
      ],
      footer: OWNER_MAIL_FOOTER,
    }),
  };
}
