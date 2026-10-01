/* ── worker/src/emails.js ───────────────────────────────────────
   What the customer emails say and how they look. Only words and layout
   live here; who gets which one, and when, is onboarding.js.

   Two kinds, kept apart on purpose:

   - Receipts (receipt, group-receipt). Sent the moment a checkout
     completes. They restate the plan, the price, that it renews monthly
     until cancelled, the 14-day refund on the first charge, and exactly
     how to cancel: what California's automatic renewal law asks a
     confirmation to carry. Always sent, no unsubscribe link, because they
     are a record of a purchase rather than marketing.
   - Onboarding (welcome, group-welcome, member-welcome and the five tips).
     Each one has a single job, a one-click unsubscribe, and a footer that
     says why it came. The student can turn them off in Settings.

   Every email is a small branded page: a wordmark header, a hero with one
   product picture, a few short blocks, one button, and the footer. Tables
   and inline styles, because that is what email clients render; Instrument
   Serif and General Sans load where the client allows web fonts and fall
   back to Georgia and the system sans elsewhere (Gmail). A dark-mode block
   recolors it in Apple Mail and iOS Mail; Gmail's own dark mode inverts it
   safely because nothing is drawn as an image except the product shots.
   Each one also has a plain-text version.

   Voice: short sentences, warm, clear. No em dashes. Never "AI-powered":
   the syllabus upload is described by what it does.
──────────────────────────────────────────────────────────────── */

const EM_LEGAL_NAME = 'Semester HQ, LLC';
const EM_POSTAL_ADDRESS = '9660 Falls of Neuse Road, Suite 138 #273, Raleigh, NC 27615';
const EM_SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif";
const EM_SANS = "'General Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// The onboarding tips, in order, with the day after purchase each is due.
// `skipIf` names the progress flag (onboarding.js) that makes a tip pointless:
// someone who already has a class doesn't need to be told how to add one.
// The habit tip waits for a Sunday, because that is when the habit happens.
export const EMAIL_TIPS = [
  { key: 'syllabus', day: 3, skipIf: 'hasClass' },
  { key: 'calendar', day: 7 },
  { key: 'canvas', day: 11, skipIf: 'hasFeed' },
  { key: 'groups', day: 16, skipIf: 'inGroup' },
  { key: 'habit', day: 21, sunday: true },
];

function emEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function emMoney(cents) { return `$${(Math.round(cents) / 100).toFixed(2)}`; }
function emDate(d) {
  try { return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }); } catch { return ''; }
}
function emAppLink(ctx, open) {
  const url = new URL(ctx.appUrl || 'https://app.semester-hq.com/');
  if (open) url.searchParams.set('open', open);
  return url.href;
}

/* ── The page every email sits in ─────────────────────────────── */
// blocks: [{ type: 'steps', items: [[title, body]] } | { type: 'text', html }
//          | { type: 'details', rows: [[label, value]] } | { type: 'note', title, html }]
function emLayout({ preheader, eyebrow, title, lead, image, blocks = [], cta, after, footer, transactional, appUrl }) {
  const navLink = (label, open) => `<a href="${emEsc(emAppLink({ appUrl }, open))}" class="em-muted" style="color:#5B5750;text-decoration:none;font-family:${EM_SANS};font-size:13px;font-weight:500">${label}</a>`;
  const nav = transactional ? '' : `
<tr><td class="em-pad" style="padding:0 40px 26px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:18px">${navLink('Today', 'dashboard')}</td>
    <td style="padding-right:18px">${navLink('Calendar', 'calendar')}</td>
    <td style="padding-right:18px">${navLink('Courses', 'courses')}</td>
    <td>${navLink('Study Groups', 'studygroups')}</td>
  </tr></table>
</td></tr>`;
  const band = transactional ? '' : `
<tr><td style="padding:44px 0 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-band" style="background:#121212;border-radius:18px"><tr><td class="em-pad" style="padding:34px 40px">
    <p style="margin:0 0 8px;font-family:${EM_SERIF};font-size:28px;line-height:1.15;color:#F8F6F2">Questions? Just reply.</p>
    <p style="margin:0;font-family:${EM_SANS};font-size:15px;line-height:1.6;color:#CFC6BB">A real person reads every email that comes back to us, and we’d love to hear how your semester is going.</p>
  </td></tr></table>
</td></tr>`;
  const img = image ? `
<tr><td class="em-pad" style="padding:8px 40px 8px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" class="em-panel" style="background:#EFE8E1;border-radius:18px;padding:${image.phone ? '28px 24px 0' : '20px 20px 0'}">
    <img src="${emEsc(image.src)}" width="${image.phone ? 260 : 480}" alt="${emEsc(image.alt)}" style="display:block;width:100%;max-width:${image.phone ? 260 : 480}px;height:auto;border:0;border-radius:${image.phone ? '22px 22px 0 0' : '10px 10px 0 0'};box-shadow:0 1px 2px rgba(18,18,18,.08)">
  </td></tr></table>
</td></tr>` : '';

  const blockHtml = blocks.map((b) => {
    if (b.type === 'steps') {
      return `<tr><td class="em-pad" style="padding:12px 40px 4px">${b.items.map(([t, body], i) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>
    <td valign="top" width="44" style="width:44px;padding-top:2px"><div class="em-accent" style="font-family:${EM_SERIF};font-size:26px;line-height:1;color:#B49F90">${String(i + 1).padStart(2, '0')}</div></td>
    <td valign="top"><p class="em-ink" style="margin:0 0 4px;font-family:${EM_SANS};font-size:16px;line-height:1.4;font-weight:600;color:#121212">${t}</p>
      <p class="em-muted" style="margin:0;font-family:${EM_SANS};font-size:15px;line-height:1.55;color:#5B5750">${body}</p></td>
  </tr></table>`).join('')}</td></tr>`;
    }
    if (b.type === 'details') {
      return `<tr><td class="em-pad" style="padding:8px 40px 8px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="background:#FFFFFF;border:1px solid #E8E1D8;border-radius:14px">
  ${b.rows.map(([label, value], i) => `<tr><td class="em-rule" style="padding:14px 20px;${i ? 'border-top:1px solid #EFE8E1;' : ''}">
    <p class="em-accent" style="margin:0 0 3px;font-family:${EM_SANS};font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:#9A8474">${label}</p>
    <p class="em-ink" style="margin:0;font-family:${EM_SANS};font-size:15px;line-height:1.5;color:#121212">${value}</p></td></tr>`).join('')}
  </table></td></tr>`;
    }
    if (b.type === 'note') {
      return `<tr><td class="em-pad" style="padding:8px 40px 8px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="em-rule" style="border-left:3px solid #B49F90;padding:4px 0 4px 16px">
    ${b.title ? `<p class="em-ink" style="margin:0 0 4px;font-family:${EM_SANS};font-size:15px;font-weight:600;color:#121212">${b.title}</p>` : ''}
    <p class="em-muted" style="margin:0;font-family:${EM_SANS};font-size:15px;line-height:1.55;color:#5B5750">${b.html}</p></td></tr></table></td></tr>`;
    }
    return `<tr><td class="em-pad" style="padding:8px 40px"><p class="em-ink" style="margin:0;font-family:${EM_SANS};font-size:16px;line-height:1.6;color:#121212">${b.html}</p></td></tr>`;
  }).join('');

  const button = cta ? `
<tr><td class="em-pad" style="padding:20px 40px 8px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="em-btn" style="background:#121212;border-radius:999px">
    <a class="em-btn-text" href="${emEsc(cta.href)}" style="display:inline-block;padding:15px 28px;font-family:${EM_SANS};font-size:15px;font-weight:600;line-height:1;color:#F8F6F2;text-decoration:none;border-radius:999px">${emEsc(cta.label)}</a>
  </td></tr></table>
</td></tr>` : '';

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${emEsc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  a { color:#121212; }
  @media (max-width: 620px) {
    .em-pad { padding-left:22px !important; padding-right:22px !important; }
    .em-h1 { font-size:36px !important; }
    .em-shell { border-radius:0 !important; }
  }
  @media (prefers-color-scheme: dark) {
    .em-bg, .em-shell { background:#151413 !important; }
    .em-card { background:#1E1C1A !important; border-color:#34302C !important; }
    .em-panel { background:#26221F !important; }
    .em-rule { border-color:#34302C !important; }
    .em-ink, .em-ink a { color:#F3EFE9 !important; }
    .em-muted, .em-muted a { color:#BDB5AA !important; }
    .em-accent { color:#C9B6A8 !important; }
    .em-btn { background:#F3EFE9 !important; }
    .em-band { background:#2A2522 !important; }
    .em-btn-text { color:#121212 !important; }
  }
  [data-ogsc] .em-ink { color:#F3EFE9 !important; }
  [data-ogsc] .em-muted { color:#BDB5AA !important; }
  [data-ogsb] .em-bg, [data-ogsb] .em-shell { background:#151413 !important; }
</style>
</head>
<body class="em-bg" style="margin:0;padding:0;background:#F8F6F2">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${emEsc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-bg" style="background:#F8F6F2">
<tr><td align="center" style="padding:24px 12px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-shell" style="max-width:600px;background:#F8F6F2">

<tr><td class="em-pad" style="padding:8px 40px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td><a href="https://semester-hq.com/" class="em-ink" style="font-family:${EM_SERIF};font-size:26px;line-height:1;color:#121212;text-decoration:none">Semester HQ<span class="em-accent" style="color:#B49F90;font-size:18px;vertical-align:4px;padding-left:3px">&#10022;</span></a></td>
    <td align="right" class="em-accent" style="font-family:${EM_SANS};font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;color:#9A8474">${emEsc(eyebrow)}</td>
  </tr></table>
  <div class="em-rule" style="border-top:1px solid #E3DBD1;margin-top:18px;font-size:0;line-height:0">&nbsp;</div>
</td></tr>
${nav}
<tr><td class="em-pad" style="padding:8px 40px 4px">
  <h1 class="em-ink em-h1" style="margin:0 0 14px;font-family:${EM_SERIF};font-weight:400;font-size:44px;line-height:1.05;letter-spacing:-.01em;color:#121212">${title}</h1>
  <p class="em-muted" style="margin:0 0 18px;font-family:${EM_SANS};font-size:17px;line-height:1.55;color:#5B5750">${lead}</p>
</td></tr>
${img}
${blockHtml}
${button}
${after ? `<tr><td class="em-pad" style="padding:18px 40px 0"><p class="em-muted" style="margin:0;font-family:${EM_SANS};font-size:15px;line-height:1.6;color:#5B5750">${after}</p></td></tr>` : ''}
${band}

<tr><td class="em-pad" style="padding:40px 40px 0">
  <div class="em-rule" style="border-top:1px solid #E3DBD1;font-size:0;line-height:0">&nbsp;</div>
  <p class="em-ink" style="margin:22px 0 10px;font-family:${EM_SERIF};font-size:20px;line-height:1;color:#121212">Semester HQ<span class="em-accent" style="color:#B49F90;font-size:14px;vertical-align:3px;padding-left:2px">&#10022;</span></p>
  <p class="em-muted" style="margin:0 0 10px;font-family:${EM_SANS};font-size:13px;line-height:1.6;color:#6E685F">Your entire semester, finally in one place.</p>
  <p class="em-muted" style="margin:0 0 10px;font-family:${EM_SANS};font-size:13px;line-height:1.6;color:#6E685F">${footer}</p>
  <p class="em-muted" style="margin:0;font-family:${EM_SANS};font-size:12px;line-height:1.6;color:#8A8378">${EM_LEGAL_NAME} &middot; ${EM_POSTAL_ADDRESS}</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

/* ── Plain text, for every client that wants it ───────────────── */
function emText({ title, lead, blocks = [], cta, after, footerText, transactional }) {
  const strip = (h) => String(h).replace(/<br\s*\/?>/g, '\n').replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, (m, href, label) => {
    const bare = href.replace(/^mailto:/, '').replace(/^https?:\/\//, '');
    return bare === label ? href.replace(/^mailto:/, '') : `${label} (${href})`;
  }).replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
  const out = [strip(title), '', strip(lead), ''];
  for (const b of blocks) {
    if (b.type === 'steps') b.items.forEach(([t, body], i) => out.push(`${i + 1}. ${strip(t)}`, `   ${strip(body)}`, ''));
    else if (b.type === 'details') { b.rows.forEach(([l, v]) => out.push(`${strip(l)}: ${strip(v)}`)); out.push(''); }
    else if (b.type === 'note') out.push(b.title ? `${strip(b.title)} ${strip(b.html)}` : strip(b.html), '');
    else out.push(strip(b.html), '');
  }
  if (cta) out.push(`${cta.label}: ${cta.href}`, '');
  if (after) out.push(strip(after), '');
  if (!transactional) out.push('Questions? Just reply. A real person reads every email that comes back to us.', '');
  out.push('--', 'Semester HQ', 'Your entire semester, finally in one place.', '', footerText, `${EM_LEGAL_NAME}, ${EM_POSTAL_ADDRESS}`);
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ── The emails ───────────────────────────────────────────────── */
const EM_FIRST_STEPS = [
  ['Add your classes.', 'Upload a syllabus and Semester HQ reads it for you: class times, office hours, and every assignment and exam. You look it over and keep what’s right.'],
  ['Check your week.', 'Your calendar brings everything together, so a busy week never sneaks up on you.'],
  ['Make it yours.', 'Add to-dos as they come up, keep notes by class, and turn them into flashcards when exams get close.'],
];

function emContent(key, ctx) {
  const app = (open) => emAppLink(ctx, open);
  const img = (name, alt, phone) => ({ src: `${ctx.imageBase}${name}.jpg`, alt, phone });
  switch (key) {
    case 'receipt': return {
      subject: 'Your Semester HQ Plus subscription is active',
      preheader: 'Your plan, your price, and how to cancel. Worth keeping for your records.',
      eyebrow: 'Subscription confirmed',
      title: 'You’re all set.',
      lead: 'Thank you for subscribing to Semester HQ Plus. Here are the details of your plan, in plain words.',
      blocks: [{ type: 'details', rows: [
        ['Plan', 'Semester HQ Plus'],
        ['Price', `${emMoney(ctx.priceCents || 799)} a month`],
        ['Renewal', `Renews automatically every month until you cancel${ctx.startedAt ? `. Started ${emEsc(emDate(ctx.startedAt))}, and charged on the same date each month` : ''}.`],
        ['Refund', 'If it’s not for you, email <a href="mailto:hello@semester-hq.com" style="color:inherit">hello@semester-hq.com</a> within 14 days of your first charge and we’ll refund it in full.'],
        ['How to cancel', 'In the app, open <strong>Settings</strong>, then <strong>Account &amp; Sync</strong>, then <strong>Manage subscription</strong>. Or email <a href="mailto:hello@semester-hq.com" style="color:inherit">hello@semester-hq.com</a>. Cancelling stops the next charge, and you keep access until the end of the month you’ve paid for.'],
      ] }],
      cta: { label: 'Open Semester HQ', href: app() },
      after: `The full terms are at <a href="https://semester-hq.com/terms.html" style="color:inherit">semester-hq.com/terms.html</a>. Questions about a charge? Just reply to this email.`,
      transactional: true,
    };
    case 'group-receipt': {
      const seats = Math.max(1, Math.round(ctx.seats || 0));
      const seat = ctx.seatCents || 599;
      return {
        subject: 'Your Semester HQ group plan is active',
        preheader: 'Your seats, your price, and how to cancel. Worth keeping for your records.',
        eyebrow: 'Group plan confirmed',
        title: 'Your group plan is ready.',
        lead: `Thank you for setting up Semester HQ${ctx.groupName ? ` for ${emEsc(ctx.groupName)}` : ''}. Here are the details of your plan.`,
        blocks: [{ type: 'details', rows: [
          ['Plan', `Semester HQ group plan, ${seats} seat${seats === 1 ? '' : 's'}`],
          ['Price', `${emMoney(seat)} per seat a month, ${emMoney(seat * seats)} a month in total`],
          ['Renewal', `Renews automatically every month until you cancel${ctx.startedAt ? `. Started ${emEsc(emDate(ctx.startedAt))}, and charged on the same date each month` : ''}. Adding or removing seats changes the next charge.`],
          ['Refund', 'If it’s not for you, email <a href="mailto:hello@semester-hq.com" style="color:inherit">hello@semester-hq.com</a> within 14 days of your first charge and we’ll refund it in full.'],
          ['How to cancel', `Open your <a href="${emEsc(new URL('group-admin.html', ctx.appUrl).href)}" style="color:inherit">group plan page</a>, sign in, and under <strong>Billing</strong> choose <strong>Manage billing</strong>. Or email <a href="mailto:hello@semester-hq.com" style="color:inherit">hello@semester-hq.com</a>. Cancelling stops the next charge, and everyone keeps access until the end of the month you’ve paid for.`],
          ['Members', 'Members aren’t charged. Anyone with your invite link can take a seat, so share it only with the people you mean to cover.'],
        ] }],
        cta: { label: 'Open your group plan', href: new URL('group-admin.html', ctx.appUrl).href },
        after: `The full terms are at <a href="https://semester-hq.com/terms.html" style="color:inherit">semester-hq.com/terms.html</a>. Questions about a charge? Just reply to this email.`,
        transactional: true,
      };
    }
    case 'welcome': return {
      subject: 'Welcome to Semester HQ',
      preheader: 'Three things to do first, and what to expect from us.',
      eyebrow: 'Welcome',
      title: 'Your entire semester, finally in one place.',
      lead: 'We’re so glad you’re here. Semester HQ works best once your classes are in, so here’s the quickest way to get there.',
      image: img('welcome', 'The Semester HQ dashboard on a phone, showing what’s due today', true),
      blocks: [{ type: 'steps', items: EM_FIRST_STEPS }],
      cta: { label: 'Open Semester HQ', href: app() },
      after: 'Over the next few weeks we’ll send a handful of short notes, each with one idea and spaced days apart. If you’d rather not get them, the link at the bottom turns them off.',
    };
    case 'member-welcome': return {
      subject: ctx.groupName ? `${String(ctx.groupName).replace(/[<>\r\n]/g, '').slice(0, 60)} has you covered on Semester HQ` : 'Your group has you covered on Semester HQ',
      preheader: 'Everything is unlocked, and your seat is paid for.',
      eyebrow: 'Welcome',
      title: 'You’re in.',
      lead: `${ctx.groupName ? emEsc(ctx.groupName) : 'Your group'} is covering your Semester HQ Plus, so everything is unlocked: sync across your devices, syllabus upload, study groups and clubs.`,
      image: img('welcome', 'The Semester HQ dashboard on a phone, showing what’s due today', true),
      blocks: [
        { type: 'note', title: 'You won’t be charged.', html: 'Your seat is paid for by the group. If you ever leave it, your account and everything in it stay yours.' },
        { type: 'steps', items: EM_FIRST_STEPS },
      ],
      cta: { label: 'Open Semester HQ', href: app() },
      after: 'Over the next few weeks we’ll send a handful of short notes, each with one idea and spaced days apart. If you’d rather not get them, the link at the bottom turns them off.',
    };
    case 'group-welcome': return {
      subject: 'Getting your group started',
      preheader: 'Three steps to get everyone on board.',
      eyebrow: 'Group plan',
      title: 'Three steps to get everyone on board.',
      lead: `Your plan${ctx.groupName ? ` for ${emEsc(ctx.groupName)}` : ''} is live. Here’s how to get your members set up.`,
      image: img('groups', 'Study groups in Semester HQ', false),
      blocks: [{ type: 'steps', items: [
        ['Share your invite link.', 'Open your group plan page and copy the invite link, or put its QR code up with <strong>Show on screen</strong> at your next meeting. Anyone with it can take a seat, so share it only with the people you mean to cover.'],
        ['Watch the seats fill.', 'Your group plan page shows who has joined and how many seats are left.'],
        ['Adjust any time.', 'Add seats, remove a member, make a <strong>New link</strong> if the old one got around, or make another member an admin, all from the same page.'],
      ] }],
      cta: { label: 'Open your group plan', href: new URL('group-admin.html', ctx.appUrl).href },
      after: 'Each member signs in as themselves and gets their own Semester HQ. Their planners are private to them, and that includes from you.',
    };
    case 'syllabus': return {
      subject: 'Your syllabus can do the setup for you',
      preheader: 'Upload it once. Get every class time, deadline and exam.',
      eyebrow: 'Getting started',
      title: 'Let your syllabus set up your class.',
      lead: 'Typing in a whole semester of deadlines takes an evening. Uploading your syllabus takes about a minute.',
      image: img('syllabus', 'A class page in Semester HQ, filled in from a syllabus', false),
      blocks: [{ type: 'steps', items: [
        ['Upload it.', 'A PDF, a Word file, or a photo of the page all work.'],
        ['Semester HQ reads it.', 'It finds your class times, office hours, assignments and exams, with their dates.'],
        ['You check it.', 'Nothing is saved until you’ve looked it over. Keep what’s right, fix what isn’t.'],
      ] }],
      cta: { label: 'Upload a syllabus', href: app('courses') },
      after: 'No syllabus yet? Add the class by hand in Courses, and upload the syllabus once it’s posted.',
    };
    case 'calendar': return {
      subject: 'See your whole week at a glance',
      preheader: 'Classes, deadlines, exams and study time, all on one calendar.',
      eyebrow: 'Getting started',
      title: 'Your week, all in one view.',
      lead: 'Every class, deadline, exam and study session lands on one calendar, so a heavy week never catches you off guard.',
      image: img('calendar', 'The Semester HQ calendar showing a month of classes and deadlines', false),
      blocks: [{ type: 'steps', items: [
        ['Zoom out or in.', 'Look at the whole month to plan ahead, or a single day to plan tomorrow.'],
        ['Block out the time.', 'Add a time block to actually do the work, not just remember that it’s due.'],
        ['Move things around.', 'Plans change. Drag something to a new day and everything else stays put.'],
      ] }],
      cta: { label: 'Open your calendar', href: app('calendar') },
    };
    case 'canvas': return {
      subject: 'Bring your Canvas calendar with you',
      preheader: 'New assignments from your professors, added on their own.',
      eyebrow: 'Getting started',
      title: 'On Canvas? Bring it with you.',
      lead: 'If your school uses Canvas, Blackboard, Brightspace or Moodle, you can connect its calendar. Every due date comes in at once, and new ones your professors post keep arriving.',
      image: img('canvas', 'The Semester HQ calendar on a phone', true),
      blocks: [{ type: 'steps', items: [
        ['Copy your calendar link.', 'In Canvas, open Calendar and choose Calendar Feed at the bottom of the page. Other systems have the same link under Calendar.'],
        ['Paste it in Semester HQ.', 'Open Assignments, tap <strong>Import from Canvas</strong>, and paste the link.'],
        ['That’s it.', 'Semester HQ only reads the calendar. It never changes anything in Canvas.'],
      ] }],
      cta: { label: 'Connect your calendar', href: app('assignments') },
    };
    case 'groups': return {
      subject: 'Studying is easier together',
      preheader: 'Start a study group in a minute, or join one with a code.',
      eyebrow: 'Getting started',
      title: 'Start a study group in a minute.',
      lead: 'Pick a class, share a six-character code, and everyone who joins gets one place to plan sessions, share notes and flashcards, and talk.',
      image: img('groups', 'Study groups in Semester HQ', false),
      blocks: [
        { type: 'steps', items: [
          ['Start one.', 'Open Study Groups, tap <strong>New group</strong>, and send the code to your classmates.'],
          ['Or join one.', 'Got a code from someone? Tap <strong>Join with code</strong> and you’re in.'],
          ['Find a time.', 'Everyone adds when they’re free, and Semester HQ shows the times that work for the whole group.'],
        ] },
        { type: 'note', title: 'Running a club or team?', html: 'Clubs & Teams work the same way: events, announcements, RSVPs and forms in one place, and a QR code to invite people at your first meeting.' },
      ],
      cta: { label: 'Open Study Groups', href: app('studygroups') },
    };
    case 'habit': return {
      subject: 'The ten-minute habit that makes a semester easier',
      preheader: 'One small routine, once a week. Here’s the whole thing.',
      eyebrow: 'A weekly habit',
      title: 'Ten minutes on Sunday.',
      lead: 'The students who stay ahead usually aren’t working more. They look ahead once a week. Here’s the whole routine.',
      image: img('habit', 'The Semester HQ to-do list on a phone', true),
      blocks: [{ type: 'steps', items: [
        ['Look at the next seven days.', 'Open your calendar and see what’s coming.'],
        ['Tidy your to-dos.', 'Check off what’s done and move anything that slipped.'],
        ['Protect the big things.', 'Block time for the two biggest things due this week.'],
        ['Glance at the next exam.', 'Add a study session or two before it gets close.'],
      ] }],
      cta: { label: 'Plan my week', href: app('calendar') },
      after: 'That’s the last note in this series. From here on, we’ll only email you when there’s something genuinely worth knowing.',
    };
    default: return null;
  }
}

// { subject, html, text, transactional } for one email, or null for an
// unknown key. ctx: appUrl, imageBase, prefsUrl, unsubscribeUrl, and per
// email: groupName, seats, seatCents, priceCents, startedAt.
export function renderEmail(key, ctx = {}) {
  const c = emContent(key, { imageBase: 'https://semester-hq.com/assets/email/', appUrl: 'https://app.semester-hq.com/', ...ctx });
  if (!c) return null;
  const footer = c.transactional
    ? 'You’re getting this because you bought a Semester HQ plan. It’s a record of your purchase, so it comes whatever your email settings are.'
    : `You’re getting this because you have a Semester HQ plan. <a href="${emEsc(ctx.prefsUrl || '')}" style="color:inherit">Email settings</a> &middot; <a href="${emEsc(ctx.unsubscribeUrl || '')}" style="color:inherit">Unsubscribe from these tips</a>`;
  const footerText = c.transactional
    ? 'You’re getting this because you bought a Semester HQ plan. It’s a record of your purchase, so it comes whatever your email settings are.'
    : `You’re getting this because you have a Semester HQ plan.\nEmail settings: ${ctx.prefsUrl || ''}\nUnsubscribe from these tips: ${ctx.unsubscribeUrl || ''}`;
  return {
    subject: c.subject,
    transactional: !!c.transactional,
    html: emLayout({ ...c, footer, appUrl: ctx.appUrl || 'https://app.semester-hq.com/' }),
    text: emText({ ...c, footerText }),
  };
}
