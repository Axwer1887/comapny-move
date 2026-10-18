/**
 * Access code gate for the whole site (free alternative to Netlify's paid
 * password protection). Runs on Netlify's edge before any file is served.
 *
 *  - Set the code in Netlify: Site configuration → Environment variables →
 *    SITE_ACCESS_CODE. Without it the site stays open (nothing is blocked).
 *  - Share a link with the code:  https://<your-site>.netlify.app/?code=XXXX
 *    or just the plain link; visitors then type the code on a login page.
 *  - After a correct code the browser keeps access for 30 days (cookie).
 *    Changing the code logs everyone out.
 */

declare const Netlify: { env: { get(name: string): string | undefined } };

const COOKIE = 'cm_access';
const MAX_AGE = 60 * 60 * 24 * 30;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison so the code cannot be guessed by timing. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function page(error: boolean, lang: 'hu' | 'en'): string {
  const T = {
    hu: {
      title: 'Belépés',
      lead: 'Ez az oldal védett. Add meg a hozzáférési kódot.',
      label: 'Hozzáférési kód',
      button: 'Belépés',
      wrong: 'Hibás kód. Próbáld újra.',
    },
    en: {
      title: 'Sign in',
      lead: 'This site is protected. Enter the access code.',
      label: 'Access code',
      button: 'Enter',
      wrong: 'Wrong code. Please try again.',
    },
  }[lang];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>COMPANY MOVE – ${T.title}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
         background: #111b25; color: #17212f; font: 14px/1.5 Inter, "Segoe UI", system-ui, Arial, sans-serif; }
  .card { width: min(380px, 100%); padding: 28px; border-radius: 8px; background: #fff; box-shadow: 0 18px 48px rgba(0,0,0,.35); }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .mark { width: 40px; height: 40px; border-radius: 6px; background: #1677ff; display: grid; place-items: center; color: #fff; font-weight: 800; }
  .brand strong { display: block; font-size: 16px; letter-spacing: .02em; }
  .brand span { display: block; color: #64748b; font-size: 10px; letter-spacing: .2em; }
  p { margin: 0 0 16px; color: #64748b; }
  label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 13px; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #dce3eb; border-radius: 6px; font: inherit; font-size: 15px; }
  input:focus { outline: none; border-color: #1677ff; box-shadow: 0 0 0 3px rgba(22,119,255,.28); }
  button { width: 100%; margin-top: 14px; padding: 11px; border: 0; border-radius: 6px; background: #1677ff; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
  button:hover { background: #0865e8; }
  .err { margin: 12px 0 0; color: #dc4545; font-weight: 600; }
</style>
</head>
<body>
  <form class="card" method="post">
    <div class="brand"><div class="mark">CM</div><div><strong>COMPANY MOVE</strong><span>LOCATION MAP MAKER</span></div></div>
    <p>${T.lead}</p>
    <label for="code">${T.label}</label>
    <input id="code" name="code" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">${T.button}</button>
    ${error ? `<p class="err" role="alert">${T.wrong}</p>` : ''}
  </form>
</body>
</html>`;
}

export default async (req: Request, context: { next: () => Promise<Response> }) => {
  const code = Netlify.env.get('SITE_ACCESS_CODE');
  if (!code) return context.next(); // not configured: site stays public

  const token = await sha256(`company-move:${code}`);
  const cookie = readCookie(req, COOKIE);
  if (cookie && same(cookie, token)) return context.next();

  const url = new URL(req.url);
  let given = url.searchParams.get('code') ?? url.searchParams.get('kod');
  if (!given && req.method === 'POST') {
    const form = await req.formData().catch(() => null);
    const v = form?.get('code');
    given = typeof v === 'string' ? v : null;
  }

  if (given !== null && same(given.trim(), code)) {
    // Correct: remember for 30 days and continue to the page without the code in the URL.
    url.searchParams.delete('code');
    url.searchParams.delete('kod');
    return new Response(null, {
      status: 303,
      headers: {
        Location: url.pathname + (url.search || ''),
        'Set-Cookie': `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const lang = /^hu\b/i.test(req.headers.get('accept-language') || '') ? 'hu' : 'en';
  return new Response(page(given !== null, lang), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
};

export const config = { path: '/*' };
