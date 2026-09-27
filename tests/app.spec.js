// End-to-end tests for Call Center X-Ray (רנטגן למוקד).
// The app runs outside Claude here, so live AI calls go to the Anthropic API,
// which these tests intercept with page.route and answer with fixed replies.
const { test, expect } = require('@playwright/test');

const API = 'https://api.anthropic.com/v1/messages';

/** Answer every Anthropic API call with `text`, and record the request bodies. */
async function mockClaude(page, text) {
  const bodies = [];
  await page.route(API, async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ content: [{ type: 'text', text }] }),
    });
  });
  return bodies;
}

/** Open the app. Feature tests see every screen at once (screens: false);
 *  navigation tests use the real one-screen-at-a-time app (screens: true). */
async function open(page, { tour = false, screens = false } = {}) {
  if (!tour) await page.addInitScript(() => localStorage.setItem('xray-tour', 'done'));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/index.html');
  await expect(page.locator('#readout')).toContainText('25/25');
  if (!screens) await showAll(page);
  return errors;
}
const showAll = (page) => page.evaluate(() => Object.values(VIEWS).forEach((v) => v.secs.forEach(([id]) => { document.getElementById(id).hidden = false; })));

const moneyText = (loc) => loc.innerText().then((t) => Number(t.replace(/[^\d]/g, '')));

test.describe('demo state', () => {
  test('loads with demo analysis and no script errors', async ({ page }) => {
    const errors = await open(page);
    await expect(page.locator('#demo-banner')).toBeVisible();
    await expect(page.locator('#readout')).toContainText('טווח');
    await expect(page.locator('.scen')).toHaveCount(2); // call-center summary + org map
    expect(errors).toEqual([]);
  });

  test('three savings scenarios keep the 40/70/100 ratio', async ({ page }) => {
    await open(page);
    const scen = page.locator('#r-sum .scen');
    const p = await moneyText(scen.locator('.sc-p b'));
    const r = await moneyText(scen.locator('.sc-r b'));
    const o = await moneyText(scen.locator('.sc-o b'));
    expect(o).toBeGreaterThan(0);
    expect(Math.abs(p - o * 0.4)).toBeLessThanOrEqual(1);
    expect(Math.abs(r - o * 0.7)).toBeLessThanOrEqual(1);
  });

  test('savings recalculate when monthly calls change', async ({ page }) => {
    await open(page);
    const scenO = page.locator('#r-sum .scen .sc-o b');
    const before = await moneyText(scenO);
    await page.fill('#p-calls', '36000');
    await page.locator('#p-calls').dispatchEvent('input');
    await expect.poll(() => moneyText(scenO)).toBe(before * 2);
  });

  test('every demo quote is found in the source text', async ({ page }) => {
    await open(page);
    const counts = await page.evaluate(() => verifyAll(state.analysis));
    expect(counts.total).toBeGreaterThan(20);
    expect(counts.ok).toBe(counts.total);
    await page.click('[data-r="opp"]');
    await expect(page.locator('.opp[open] .evq').first()).toContainText('מאומת 100%');
  });

  test('process map switches between today and after', async ({ page }) => {
    await open(page);
    await page.click('[data-r="proc"]');
    await expect(page.locator('#r-proc svg[aria-label="התהליך היום"]')).toBeVisible();
    await page.click('[data-pv="after"]');
    await expect(page.locator('#r-proc svg[aria-label="התהליך אחרי האוטומציות"]')).toBeVisible();
  });
});

test.describe('privacy', () => {
  test('masks ID, phone, card, email and name before sending', async ({ page }) => {
    await open(page);
    const chips = page.locator('#pii-counts');
    for (const kind of ['ת.ז', 'טלפון', 'כרטיס אשראי', 'מייל', 'שם']) await expect(chips).toContainText(kind);
    const preview = await page.locator('#pii-preview').textContent(); // lives in a collapsed <details>
    expect(preview).not.toContain('039337423');
    expect(preview).not.toContain('4580 1234 5678 9015');
    expect(preview).not.toContain('dana.levi@example.com');
    expect(preview).toContain('[ת.ז-1]');
  });

  test('checksum rules avoid false positives', async ({ page }) => {
    await open(page);
    const out = await page.evaluate(() => redact('הזמנה 123456789 וכרטיס 4580 1234 5678 9016', {}, []));
    expect(out).toContain('123456789'); // fails the Israeli ID checksum
    expect(out).toContain('4580 1234 5678 9016'); // fails Luhn
  });

  test('custom terms are masked too', async ({ page }) => {
    await open(page);
    await page.fill('#pii-extra', 'ספק אינטרנט');
    await page.locator('#pii-extra').dispatchEvent('input');
    await expect(page.locator('#pii-counts')).toContainText('מילים שהוגדרו');
    expect(await page.locator('#pii-preview').textContent()).not.toContain('ספק אינטרנט');
  });
});

test.describe('live analysis with a mocked Claude', () => {
  const analysis = {
    summary: 'סיכום בדיקה: הזמן הולך על זיהוי כפול.',
    calls_analyzed: 4,
    intents: [{ name: 'תקלת אינטרנט', share_pct: 60, avg_handle_sec: 400, note: '' }, { name: 'חשבון', share_pct: 40, avg_handle_sec: 250, note: '' }],
    sentiment: { negative_pct: 40, neutral_pct: 40, positive_pct: 20 },
    compliance: [{ issue: 'לא נמסר מספר פנייה', severity: 'בינונית', count: '1', evidence: [{ source: 2, quote: 'לא נמסר מספר פנייה' }] }],
    repeated_questions: [{ q: 'מתי מגיע הטכנאי?', count: 2, has_procedure: true }],
    process: { name: 'תקלה', steps: [
      { id: 's1', title: 'IVR', actor: 'לקוח', type: 'wait', duration_sec: 50, pain: '4 רמות', evidence: [{ source: 1, quote: 'IVR עם 4 רמות' }] },
      { id: 's2', title: 'זיהוי ידני', actor: 'נציג', type: 'manual', duration_sec: 35, pain: null, evidence: [] },
    ] },
    to_be: { note: '', steps: [{ id: 't1', title: 'זיהוי אוטומטי', actor: 'מערכת', type: 'system', duration_sec: 5, pain: null }] },
    opportunities: [{ title: 'זיהוי לקוח מה-IVR', category: 'אוטומציה', step_ids: ['s2'], description: 'בדיקה', how: ['א'], tools: ['n8n'], affected_calls_pct: 50, seconds_saved_per_call: 30, effort: 2, impact: 4, confidence: 'גבוהה', risk: '', kpi: '', evidence: [{ source: 1, quote: 'ציטוט שלא קיים במקור' }] }],
    pilot: { title: 'פיילוט', why: '', weeks: [{ week: 'שבוע 1', goal: 'בדיקה' }], success_metric: 'מדד' },
    data_gaps: [],
  };

  test('runs, validates the JSON and flags quotes that are not in the source', async ({ page }) => {
    await open(page);
    const bodies = await mockClaude(page, '```json\n' + JSON.stringify(analysis) + '\n```');
    await page.fill('#api-key', 'sk-ant-test');
    await page.click('#api-save');
    await page.click('#run');
    await expect(page.locator('#run-state')).toContainText('הניתוח הושלם');
    await expect(page.locator('#r-sum')).toContainText('סיכום בדיקה');
    await expect(page.locator('#demo-banner')).toBeHidden();
    // 2 of 3 quotes exist in the demo sources; the invented one must be flagged
    await expect(page.locator('#r-sum .kpi').nth(3)).toContainText('2/3');
    await page.click('[data-r="opp"]');
    await expect(page.locator('.opp[open] .evq').first()).toContainText('לא נמצא במקור');
    // what left the browser was redacted
    const sent = JSON.stringify(bodies[0]);
    expect(sent).not.toContain('039337423');
    expect(sent).toContain('[ת.ז-1]');
  });

  test('shows a clear error on a bad API key', async ({ page }) => {
    await open(page);
    await page.route(API, (route) => route.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
    await page.fill('#api-key', 'sk-ant-wrong');
    await page.click('#api-save');
    await page.click('#run');
    await expect(page.locator('#run-state')).toContainText('מפתח ה-API לא תקין');
  });

  test('accuracy test scores the model answers', async ({ page }) => {
    await open(page);
    const labels = await page.evaluate(() => EVAL_BUILTIN.map((r, i) => ({ id: i + 1, label: i < 2 ? 'אחר' : r.label })));
    await mockClaude(page, JSON.stringify(labels));
    await page.fill('#api-key', 'sk-ant-test');
    await page.click('#api-save');
    await page.click('#eval-run');
    await expect(page.locator('#eval-out')).toContainText('14 מתוך 16 סווגו נכון');
    await expect(page.locator('#eval-out')).toContainText('הטעויות');
  });
});

test.describe('organization AI map', () => {
  test('scores demo processes and updates when a criterion changes', async ({ page }) => {
    await open(page);
    await expect(page.locator('#org-tbl tbody tr')).toHaveCount(15);
    const row = page.locator('#org-tbl tbody tr').first();
    const before = Number(await row.locator('.feas').innerText());
    await row.locator('select[data-f="data"]').selectOption('1');
    await expect.poll(async () => Number(await page.locator('#org-tbl tbody tr').first().locator('.feas').innerText())).toBeLessThan(before);
    await expect(page.locator('#org-tbl tbody tr').first()).toContainText('קודם לסדר נתונים');
  });

  test('call-center opportunities can be added to the org map once', async ({ page }) => {
    await open(page);
    await page.click('[data-r="opp"]');
    await page.click('#addmap-all');
    const added = await page.evaluate(() => org.rows.filter((r) => r.src === 'call').length);
    expect(added).toBe(7);
    await page.click('#addmap-all');
    expect(await page.evaluate(() => org.rows.filter((r) => r.src === 'call').length)).toBe(7);
    await page.click('#org-depts button:has-text("מוקד (מניתוח שיחות)")');
    await expect(page.locator('#org-tbl tbody tr')).toHaveCount(7);
  });

  test('three-wave plan and department bars are rendered', async ({ page }) => {
    await open(page);
    await expect(page.locator('.waves .wave')).toHaveCount(3);
    await expect(page.locator('#org-out .bars .bar')).toHaveCount(7);
  });
});

test.describe('exports', () => {
  test('executive report contains the range and verified quotes', async ({ page }) => {
    await open(page);
    const html = await page.evaluate(() => execReport());
    expect(html).toContain('טווח חיסכון בחודש');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('25/25');
  });

  test('org CSV has a header and one line per process', async ({ page }) => {
    await open(page);
    const lines = (await page.evaluate(() => orgCsv())).split('\n');
    expect(lines[0]).toContain('היתכנות');
    expect(lines).toHaveLength(16);
  });
});

test.describe('screens', () => {
  test('opens on the overview dashboard with one screen visible', async ({ page }) => {
    await open(page, { screens: true });
    await expect(page.locator('#overview')).toBeVisible();
    for (const id of ['s-sources', 's-results', 's-org', 's-gov', 's-roi', 's-agents', 's-export']) await expect(page.locator('#' + id)).toBeHidden();
    await expect(page.locator('#tb-title')).toHaveText('סקירה');
    await expect(page.locator('#readout .kc')).toHaveCount(4);
    await expect(page.locator('#ov-opps .ob')).toHaveCount(5);
    await expect(page.locator('#ov-map svg')).toHaveCount(1);
    await expect(page.locator('#ov-roi svg')).toHaveCount(1);
    await expect(page.locator('#ov-gov')).toContainText('22');
    await expect(page.locator('#ov-next li')).toHaveCount(10);
  });

  test('sidebar lists every step and switches screens', async ({ page }) => {
    await open(page, { screens: true });
    await expect(page.locator('.side nav a')).toHaveCount(11); // overview + 10 steps
    await page.click('.side nav a[href="#s-org"]');
    await expect(page.locator('#s-org')).toBeVisible();
    await expect(page.locator('#overview')).toBeHidden();
    await expect(page.locator('.side nav a[href="#s-org"]')).toHaveClass(/on/);
    await expect(page.locator('#tb-title')).toHaveText('מפת AI לארגון');
    await expect(page.locator('#subnav')).toBeHidden();
  });

  test('call analysis has four steps in a sub-navigation', async ({ page }) => {
    await open(page, { screens: true });
    await page.click('.side nav a[href="#s-results"]');
    const sub = page.locator('#subnav a');
    await expect(sub).toHaveCount(4);
    await expect(page.locator('#subnav a.on')).toContainText('תוצאות');
    await sub.filter({ hasText: 'מבחן דיוק' }).click();
    await expect(page.locator('#s-eval')).toBeVisible();
    await expect(page.locator('#s-results')).toBeHidden();
  });

  test('dashboard cards link into their screens', async ({ page }) => {
    await open(page, { screens: true });
    await page.click('#overview a[href="#s-gov"]');
    await expect(page.locator('#s-gov')).toBeVisible();
    await expect(page.locator('.side nav a[data-nav="gov"]')).toHaveClass(/on/);
  });

  test('overview has the header, both tracks and the BI cards', async ({ page }) => {
    await open(page, { screens: true });
    await expect(page.locator('.hero h1')).toContainText('זיהינו');
    await expect(page.locator('.hero .track')).toHaveCount(3);
    await expect(page.locator('#ov-int svg circle')).toHaveCount(5); // five call reasons in the demo
    await expect(page.locator('#ov-int')).toContainText('סנטימנט');
    await page.click('.hero .track[href="#s-org"]');
    await expect(page.locator('#s-org')).toBeVisible();
  });

  test('every step shows its icon and full explanation', async ({ page }) => {
    await open(page, { screens: true });
    await page.click('.side nav a[href="#s-roi"]');
    await expect(page.locator('#s-roi .shead .ico')).toBeVisible();
    await expect(page.locator('#s-roi > p').first()).toBeVisible();
    await expect(page.locator('#s-roi > p').first()).toContainText('חיסכון הוא רק חצי מהתמונה');
  });
});

test.describe('guidance', () => {
  test('first visit shows a tour that walks every step and closes', async ({ page }) => {
    await open(page, { tour: true, screens: true });
    const tour = page.locator('#tour');
    await expect(tour).toBeVisible();
    await expect(page.locator('#tour-n')).toHaveText('1 / 11');
    for (let i = 0; i < 10; i++) await page.click('#tour-next');
    await expect(page.locator('#tour-next')).toHaveText('סיום');
    await expect(page.locator('#s-export')).toHaveClass(/tour-hl/);
    await expect(page.locator('#s-export')).toBeVisible(); // the tour opens each step's screen
    await page.click('#tour-next');
    await expect(tour).toBeHidden();
    await page.reload();
    await page.waitForTimeout(1200);
    await expect(tour).toBeHidden(); // remembered
    await page.click('#tour-start');
    await expect(tour).toBeVisible();
  });

  test('every step ends with a "what now" link to the next step', async ({ page }) => {
    await open(page, { screens: true });
    await expect(page.locator('.nextbar')).toHaveCount(9);
    await page.evaluate(() => go('s-results'));
    await page.click('#s-results .nextbar a');
    await expect(page.locator('#s-eval')).toBeVisible();
    await expect(page.locator('#s-results')).toBeHidden();
  });
});

test.describe('saved analyses', () => {
  test('save two states, compare old to new, load one back', async ({ page }) => {
    await open(page);
    await page.fill('#proj-name', 'לפני פיילוט');
    await page.click('#proj-form button');
    await page.fill('#p-calls', '24000');
    await page.locator('#p-calls').dispatchEvent('input');
    await page.fill('#proj-name', 'אחרי פיילוט');
    await page.click('#proj-form button');
    await expect(page.locator('#proj-list tbody tr')).toHaveCount(2);
    for (const box of await page.locator('[data-sel]').all()) await box.check();
    const cmp = page.locator('#proj-compare');
    await expect(cmp).toContainText('השוואה: לפני פיילוט מול אחרי פיילוט');
    await expect(cmp.locator('tbody tr').first().locator('td.up')).toContainText('+33%');
    await page.click('#proj-list tr:has-text("לפני פיילוט") [data-load]');
    await expect(page.locator('#p-calls')).toHaveValue('18000');
  });

  test('export and import round-trip', async ({ page }) => {
    await open(page);
    await page.fill('#proj-name', 'לייצוא');
    await page.click('#proj-form button');
    const json = await page.evaluate(() => JSON.stringify(projGet()));
    await page.evaluate(() => localStorage.removeItem('xray-projects'));
    await page.setInputFiles('#proj-import', { name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await expect(page.locator('#proj-list')).toContainText('לייצוא');
  });
});

test.describe('combined deck', () => {
  test('has nine slides covering both tracks, governance and ROI', async ({ page }) => {
    await open(page);
    const html = await page.evaluate(() => deckReport());
    expect((html.match(/<section/g) || []).length).toBe(9);
    expect(html).toContain('משילות AI');
    expect(html).toContain('ROI ומדדי הצלחה');
    for (const s of ['התמונה בקצרה', 'מה קורה במוקד', 'שלוש ההזדמנויות המובילות במוקד', 'מפת AI לארגון', 'תוכנית בשלושה גלים', 'הנחות ושקיפות']) expect(html).toContain(s);
    expect(html).toContain('חיסכון חודשי בשאר הארגון');
  });
});

test.describe('recordings', () => {
  test('transcribes an uploaded recording through a mocked Whisper API', async ({ page }) => {
    await open(page);
    let auth = '';
    await page.route('https://api.openai.com/v1/audio/transcriptions', async (route) => {
      auth = route.request().headers()['authorization'];
      await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }, body: 'לקוח: האינטרנט לא עובד. נציג: אני בודק.' });
    });
    await page.click('[data-t="audio"]');
    await page.fill('#stt-key', 'sk-test');
    await page.click('#stt-save');
    await page.setInputFiles('#audio-in', { name: 'call1.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('fake-audio') });
    await expect(page.locator('#src-list')).toContainText('call1.mp3 (תמלול)');
    expect(auth).toBe('Bearer sk-test');
  });

  test('asks for a key before sending audio', async ({ page }) => {
    await open(page);
    await page.click('[data-t="audio"]');
    await page.setInputFiles('#audio-in', { name: 'call1.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('x') });
    await expect(page.locator('#audio-status')).toContainText('הזינו קודם מפתח');
  });

  test('VTT captions are cleaned of timestamps', async ({ page }) => {
    await open(page);
    await page.click('[data-t="file"]');
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nלקוח: שלום\n\n2\n00:00:03.500 --> 00:00:05.000\nנציג: <v Agent>היי</v>\n';
    await page.setInputFiles('#file-in', { name: 'call.vtt', mimeType: 'text/vtt', buffer: Buffer.from(vtt) });
    await expect(page.locator('#src-list')).toContainText('call.vtt (כתוביות)');
    const text = await page.evaluate(() => state.sources.find((s) => s.name.startsWith('call.vtt')).text);
    expect(text).toBe('לקוח: שלום\nנציג: היי');
  });
});

test.describe('AI governance', () => {
  test('every recommended AI use lands in the register with a risk tier', async ({ page }) => {
    await open(page);
    const items = await page.evaluate(() => govItems().map((g) => ({ name: g.name, tier: g.tier, n: g.controls.length })));
    expect(items.length).toBe(22); // 15 org processes + 7 call-center opportunities
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(byName['סינון ראשוני של קורות חיים'].tier).toBe(2); // decisions about people
    expect(byName['תיאום ראיונות עבודה'].tier).toBe(0);
    expect(byName['סינון ראשוני של קורות חיים'].n).toBeGreaterThan(byName['תיאום ראיונות עבודה'].n);
  });

  test('high-risk uses require an impact assessment and a bias check', async ({ page }) => {
    await open(page);
    const ids = await page.evaluate(() => govItems().find((g) => g.name === 'סינון ראשוני של קורות חיים').controls.map((c) => c.id));
    for (const id of ['dpia', 'bias', 'review', 'acc', 'log']) expect(ids).toContain(id);
    expect(ids).not.toContain('hitl'); // already human-approved by design (assist type)
  });

  test('owner, status and controls are saved and counted', async ({ page }) => {
    await open(page);
    const row = page.locator('#gov-tbl tbody tr').first();
    await row.locator('[data-own]').fill('דנה, מנהלת מוקד');
    await row.locator('[data-own]').dispatchEvent('change');
    await page.locator('#gov-tbl tbody tr').first().locator('details summary').click();
    await page.locator('#gov-tbl tbody tr').first().locator('[data-c="owner"]').check();
    await expect(page.locator('#gov-kpis')).toContainText('1 מתוך');
    await page.locator('#gov-tbl tbody tr').first().locator('[data-st]').selectOption('בייצור');
    await expect(page.locator('#gov-tbl tbody tr').first()).toContainText('בייצור בלי כל הבקרות');
    await page.reload();
    await expect(page.locator('#gov-tbl tbody tr').first().locator('[data-own]')).toHaveValue('דנה, מנהלת מוקד');
  });

  test('risk filter and register export', async ({ page }) => {
    await open(page);
    await page.click('[data-gf="2"]');
    const n = await page.locator('#gov-tbl tbody tr').count();
    expect(n).toBeGreaterThan(0);
    for (const tr of await page.locator('#gov-tbl tbody tr').all()) await expect(tr).toContainText('סיכון גבוה');
    const csv = await page.evaluate(() => govCsv());
    expect(csv.split('\n')[0]).toContain('בקרות חסרות');
  });

  test('policy draft is written by (mocked) Claude from the register', async ({ page }) => {
    await open(page);
    const bodies = await mockClaude(page, '# מדיניות שימוש בבינה מלאכותית\nטיוטה לעבודה, לא ייעוץ משפטי.');
    await page.fill('#api-key', 'sk-ant-test');
    await page.click('#api-save');
    await page.click('#gov-policy');
    await expect(page.locator('#gov-policy-out')).toContainText('מדיניות שימוש בבינה מלאכותית');
    expect(JSON.stringify(bodies[0])).toContain('סינון ראשוני של קורות חיים');
  });
});

test.describe('ROI and KPIs', () => {
  test('payback and 12-month ROI follow the cost and saving formulas', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const it = roiItems(), P = portfolio(it, 'r'), inc = it.filter((i) => i.inc);
      const once = inc.reduce((n, i) => n + i.once, 0), net = inc.reduce((n, i) => n + i.r.net, 0);
      return { n: P.n, nInc: inc.length, once: P.once, onceSum: once, pay: P.pay, payCalc: once / net, roi: P.roi12, roiCalc: (12 * net - once) / once, be: P.be,
        allFast: inc.every((i) => i.r.pay <= 12), item: it[0] };
    });
    expect(r.n).toBe(r.nInc);
    expect(r.once).toBe(r.onceSum);
    expect(r.pay).toBeCloseTo(r.payCalc, 6);
    expect(r.roi).toBeCloseTo(r.roiCalc, 6);
    expect(r.allFast).toBe(true); // default portfolio = payback within a year
    expect(r.be).toBeGreaterThan(0);
    expect(r.item.r.net).toBeCloseTo(r.item.save * 0.7 - r.item.run, 6);
  });

  test('inclusion and cost edits change the totals and are saved', async ({ page }) => {
    await open(page);
    const count = () => page.evaluate(() => portfolio(roiItems(), 'r').n);
    const n0 = await count();
    await page.click('#roi-all');
    const all = await page.evaluate(() => roiItems().length);
    expect(await count()).toBe(all);
    const row = page.locator('#roi-tbl tbody tr').first();
    await row.locator('[data-inc]').uncheck();
    expect(await count()).toBe(all - 1);
    const first = page.locator('#roi-tbl tbody tr').first();
    await first.locator('[data-once]').fill('99000');
    await first.locator('[data-once]').dispatchEvent('change');
    await page.reload();
    await showAll(page);
    expect(await count()).toBe(all - 1);
    expect(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('xray-roi'))).some((o) => o.once === 99000))).toBe(true);
    await page.click('#roi-top');
    expect(await count()).toBeLessThanOrEqual(all);
    expect(n0).toBeGreaterThan(0);
  });

  test('KPI status reads progress from baseline to target in either direction', async ({ page }) => {
    await open(page);
    const s = await page.evaluate(() => [
      kpiStatus({ base: 10, target: 5, cur: 6 }).t, // 80% of the way down
      kpiStatus({ base: 10, target: 5, cur: 9 }).t, // 20%
      kpiStatus({ base: 0, target: 80, cur: 30 }).t, // 37.5% up
      kpiStatus({ base: 10, target: 5, cur: 4 }).t, // past target
      kpiStatus({ base: 10, target: 5 }).t,
    ]);
    expect(s).toEqual(['בדרך ליעד', 'בפיגור', 'צריך תשומת לב', 'ביעד', 'אין עדיין נתון']);
  });

  test('KPIs are seeded from the analysis and an actual value updates the status', async ({ page }) => {
    await open(page);
    await expect(page.locator('#kpi-tbl tbody tr').first().locator('[data-f="name"]')).toHaveValue('זמן טיפול ממוצע');
    const row = page.locator('#kpi-tbl tbody tr').first();
    const base = Number(await row.locator('[data-f="base"]').inputValue());
    const target = Number(await row.locator('[data-f="target"]').inputValue());
    await row.locator('[data-f="cur"]').fill(String(target));
    await row.locator('[data-f="cur"]').dispatchEvent('change');
    await expect(page.locator('#kpi-tbl tbody tr').first()).toContainText('ביעד');
    expect(base).toBeGreaterThan(target);
    await page.click('#kpi-add');
    await expect(page.locator('#kpi-tbl tbody tr').last().locator('[data-f="name"]')).toHaveValue('מדד חדש');
  });
});

/** Answer Anthropic API calls with a fixed sequence of content arrays (tool_use loop). */
async function mockAgent(page, turns) {
  const bodies = [];
  await page.route(API, async (route) => {
    bodies.push(route.request().postDataJSON());
    const content = turns[Math.min(bodies.length - 1, turns.length - 1)];
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }),
    });
  });
  return bodies;
}

test.describe('smart agents', () => {
  const setup = async (page) => {
    await open(page);
    const name = await page.evaluate(() => roiItems().find((i) => i.inc).name);
    const bodies = await mockAgent(page, [
      [{ type: 'text', text: 'קורא את התיק' }, { type: 'tool_use', id: 't1', name: 'get_roi', input: {} }],
      [
        { type: 'tool_use', id: 't2', name: 'set_roi_inclusion', input: { name, include: false } },
        { type: 'tool_use', id: 't3', name: 'add_insight', input: { title: 'תובנת בדיקה', detail: 'פרט בדיקה עם מספר 5.', severity: 'high', area: 'roi' } },
      ],
      [{ type: 'text', text: 'סיכום: הוצאתי יוזמה אחת מהתיק.' }],
    ]);
    await page.fill('#api-key', 'sk-ant-test');
    await page.click('#api-save');
    const included = () => page.evaluate((n) => roiItems().find((i) => i.name === n).inc, name);
    return { name, bodies, included };
  };

  test('agent reads, asks before acting, records an insight, and undo restores everything', async ({ page }) => {
    const { bodies, included } = await setup(page);
    await page.click('[data-agent="roi"]');
    const ask = page.locator('#ag-trace .ask');
    await expect(ask).toBeVisible();
    expect(await included()).toBe(true); // nothing changes before approval
    await ask.getByText('אישור', { exact: true }).click();
    await expect(page.locator('#ag-trace')).toContainText('הסוכן סיים');
    expect(await included()).toBe(false);
    await expect(page.locator('#ag-insights')).toContainText('תובנת בדיקה');
    await expect(page.locator('#ag-trace')).toContainText('סיכום: הוצאתי יוזמה אחת מהתיק.');
    // The model only gets the tools this agent is allowed to use, and tool results go back.
    const names = bodies[0].tools.map((t) => t.name);
    expect(names).toContain('set_roi_inclusion');
    expect(names).not.toContain('add_kpi');
    const res = bodies[1].messages.at(-1).content[0];
    expect(res.type).toBe('tool_result');
    expect(res.tool_use_id).toBe('t1');
    expect(res.content).toContain('portfolio');
    await page.click('#ag-undo');
    expect(await included()).toBe(true);
    await expect(page.locator('#ag-insights')).not.toContainText('תובנת בדיקה');
  });

  test('a rejected action is not applied and the model is told', async ({ page }) => {
    const { bodies, included } = await setup(page);
    await page.click('[data-agent="roi"]');
    await page.locator('#ag-trace .ask').getByText('דחייה', { exact: true }).click();
    await expect(page.locator('#ag-trace')).toContainText('הסוכן סיים');
    expect(await included()).toBe(true);
    const res = bodies[2].messages.at(-1).content.find((b) => b.tool_use_id === 't2');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('rejected');
  });

  test('without approval mode the agent acts directly', async ({ page }) => {
    const { included } = await setup(page);
    await page.uncheck('#ag-approve');
    await page.click('[data-agent="roi"]');
    await expect(page.locator('#ag-trace')).toContainText('הסוכן סיים');
    expect(await included()).toBe(false);
    await expect(page.locator('#ag-undo')).toBeVisible();
  });
});

test.describe('overview story', () => {
  test('headline tells the story from the analysis', async ({ page }) => {
    await open(page, { screens: true });
    const h = page.locator('#ov-h1');
    await expect(h).toContainText('42');
    await expect(h).toContainText('זיהינו 7 הזדמנויות');
    await expect(h).toContainText('התחילו ב');
    await expect(h).toContainText('חיסכון סביר');
    await expect(page.locator('#ov-start')).toContainText('התחילו כאן');
    await expect(page.locator('#ov-opps .badge')).toHaveCount(2);
  });

  test('every KPI shows its source, scenario and time', async ({ page }) => {
    await open(page, { screens: true });
    const src = page.locator('#readout .kc-src');
    await expect(src).toHaveCount(4);
    await expect(src.nth(0)).toContainText('פרופיל המוקד');
    await expect(src.nth(0)).toContainText('נתוני דוגמה');
    await expect(page.locator('#readout .kc').nth(0)).toContainText('תרחיש סביר');
    await expect(src.nth(1)).toContainText('יוזמות בתיק');
  });

  test('journey has ten numbered steps with status and completion', async ({ page }) => {
    await open(page, { screens: true });
    const j = page.locator('#ov-next li');
    await expect(j).toHaveCount(10);
    await expect(j.nth(1)).toHaveClass(/blocked/); // analysis is locked until real sources exist
    await expect(page.locator('#ov-prog')).toContainText('%');
    await page.click('#ov-next li:nth-child(5) a');
    await expect(page.locator('#s-org')).toBeVisible();
  });

  test('governance badge counts uses without full controls', async ({ page }) => {
    await open(page, { screens: true });
    await expect(page.locator('#ov-govalert')).toBeVisible();
    await expect(page.locator('#ov-govalert')).toContainText('22 שימושי AI בלי בקרות מלאות');
  });

  test('citations tile opens a verified quote highlighted in its source', async ({ page }) => {
    await open(page, { screens: true });
    await page.click('#kc-quotes');
    await expect(page.locator('#modal')).toBeVisible();
    await expect(page.locator('#modal mark#src-mark')).toBeVisible();
    await expect(page.locator('#modal-f')).toContainText('מאומת 100%');
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal')).toBeHidden();
  });

  test('every citation in the results can be shown in its source', async ({ page }) => {
    await open(page);
    await page.click('[data-r="opp"]');
    await page.locator('.opp[open] .srcbtn').first().click();
    await expect(page.locator('#modal mark')).toBeVisible();
  });

  test('deck opens a two-slide preview before download', async ({ page }) => {
    await open(page, { screens: true });
    await page.click('#ov-deck');
    await expect(page.locator('#modal')).toBeVisible();
    await expect(page.locator('#modal-t')).toContainText('9 שקפים');
    await expect(page.locator('.slide-prev')).toHaveCount(2);
    await expect(page.locator('#modal-f')).toContainText('נתוני דוגמה (סינתטיים)');
    const html = await page.evaluate(() => deckReport());
    expect((html.match(/class="brandbar"/g) || []).length).toBe(9);
  });

  test('insights show at most three, each with one action', async ({ page }) => {
    await open(page, { screens: true });
    await page.evaluate(() => { insSave(Array.from({ length: 6 }, (_, i) => ({ title: 'תובנה ' + i, detail: 'פרט', severity: 'low', area: 'org', at: new Date().toISOString(), agent: 'סוכן' }))); go('overview'); });
    await expect(page.locator('#ov-ins .i')).toHaveCount(3);
    await page.locator('#ov-ins .i').first().locator('a.btn').click();
    await expect(page.locator('#s-org')).toBeVisible();
  });

  test('interview mode swaps in stable demo data and restores the work state', async ({ page }) => {
    await open(page, { screens: true });
    await page.evaluate(() => { document.getElementById('p-calls').value = '24000'; document.getElementById('p-calls').dispatchEvent(new Event('input')); insSave([{ title: 'שלי', detail: 'x', severity: 'low', area: 'org', at: new Date().toISOString() }]); });
    await page.check('#iv-mode');
    await expect(page.locator('#iv-banner')).toContainText('מצב ראיון');
    await expect(page.locator('#p-calls')).toHaveValue('18000');
    await expect(page.locator('#ov-ins .i')).toHaveCount(3);
    await page.reload();
    await expect(page.locator('#iv-mode')).toBeChecked(); // remembered
    await page.uncheck('#iv-mode');
    await expect(page.locator('#iv-banner')).toBeEmpty();
    await expect(page.locator('#p-calls')).toHaveValue('24000');
    await expect(page.locator('#ov-ins')).toContainText('שלי');
  });
});

test.describe('audit regressions', () => {
  test('analyst chat never sends unmasked source text or questions', async ({ page }) => {
    await open(page);
    const bodies = await mockClaude(page, 'תשובה');
    await page.fill('#api-key', 'sk-ant-test');
    await page.click('#api-save');
    // a real (non-demo) state without a stored "sent" copy: the fallback must still mask
    await page.evaluate(() => { state.isDemo = false; state.sent = null; state.sources = [{ id: 'x', name: 'שיחה', text: 'לקוח: תעודת הזהות שלי 039337423', kind: 'paste' }]; });
    await page.click('.rtabs [data-r="chat"]');
    await page.fill('#chat-in', 'מה עם 039337423?');
    await page.click('#chat-send');
    await expect(page.locator('#chat-log .bubble.a')).toContainText('תשובה');
    const sent = JSON.stringify(bodies[0]);
    expect(sent).not.toContain('039337423');
    expect(sent).toContain('[ת.ז-');
  });

  test('synthetic numbers are labelled on governance and ROI', async ({ page }) => {
    await open(page);
    await expect(page.locator('#s-gov .demo-chip')).toHaveText('נתוני דוגמה (סינתטיים)');
    await expect(page.locator('#s-roi .demo-chip')).toBeVisible();
  });

  test('analysis shows an estimated time and can be stopped', async ({ page }) => {
    await open(page);
    await page.route('https://api.anthropic.com/v1/messages', () => {}); // never answers
    await page.fill('#api-key', 'sk-ant-test');
    await page.click('#api-save');
    await page.click('#run');
    await expect(page.locator('#run-state')).toContainText('זמן משוער');
    await page.click('#stop');
    await expect(page.locator('#run-state')).toContainText('נעצר');
  });
});

