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

async function open(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/index.html');
  await expect(page.locator('#readout')).toContainText('25/25');
  return errors;
}

const moneyText = (loc) => loc.innerText().then((t) => Number(t.replace(/[^\d]/g, '')));

test.describe('demo state', () => {
  test('loads with demo analysis and no script errors', async ({ page }) => {
    const errors = await open(page);
    await expect(page.locator('#demo-banner')).toBeVisible();
    await expect(page.locator('#readout')).toContainText('בין');
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
    await expect(page.locator('.opp[open] .evq').first()).toContainText('נמצא במקור');
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
    await expect(page.locator('.opp[open] .evq').first()).toContainText('לא נמצא מילה במילה');
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
