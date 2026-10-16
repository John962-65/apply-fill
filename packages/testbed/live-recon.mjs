import { chromium } from '@playwright/test';

const url = process.argv[2];

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  proxy: { server: 'http://127.0.0.1:7897' },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(6000);

console.log('WEBDRIVER=', await page.evaluate(() => navigator.webdriver));

const close = page.locator('[class*="Modal-close-outer"]').first();
await close.click({ timeout: 8000 }).catch((error) => console.log('CLOSE_ERR=', String(error).slice(0, 100)));
await page.waitForTimeout(1200);
const portalVisible = await page.evaluate(() => {
  const portal = document.querySelector('[class*="Modal-portal"]');
  if (portal === null) return false;
  const rect = portal.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
});
console.log('PORTAL_VISIBLE_AFTER_CLICK=', portalVisible);

if (portalVisible) {
  await page.evaluate(() => {
    document.querySelector('[class*="Modal-portal"]')?.remove();
  });
  await page.waitForTimeout(500);
  console.log('PORTAL_REMOVED');
}

const genderInput = page.locator('input[placeholder*="请选择 / Please sel"]').first();
const genderBox = await genderInput.evaluate((element) => {
  const wrapper = element.closest('div');
  const r = wrapper.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(genderBox.x, genderBox.y);
await page.waitForTimeout(1000);
const options = await page.evaluate(() => {
  const list = [];
  for (const element of document.querySelectorAll('[class*="sd-Select"] [class*="option"], [class*="dropdown"] [class*="item"], [role="option"]')) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (text !== '' && text.length < 40) list.push(text);
    }
  }
  return [...new Set(list)].slice(0, 20);
});
console.log('GENDER_OPTIONS=', JSON.stringify(options, null, 0).slice(0, 800));
await page.screenshot({ path: '/tmp/opencode/moka-select-open.png' });

const dateFields = await page.evaluate(() => {
  const list = [];
  for (const element of document.querySelectorAll('input')) {
    const placeholder = element.getAttribute('placeholder') ?? '';
    if (placeholder.includes('出生日期') || placeholder.includes('Date of Birth')) {
      const r = element.getBoundingClientRect();
      list.push({ placeholder, readonly: element.readOnly, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width)] });
    }
  }
  return list;
});
console.log('BIRTH_FIELDS=', JSON.stringify(dateFields));
await browser.close();
