/* Cyberdeck console reskin verify — visual + structural, paint-only reskin checks. */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:3002';
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

async function enterAndDeck(page, width, height, shot) {
  await page.setViewport({ width, height, isMobile: height < 900, hasTouch: height < 900 });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2000));
  const input = await page.$('input');
  if (input) {
    await input.type('deck', { delay: 15 });
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /enter/i.test(x.innerText)); if (b) b.click(); });
    await new Promise((r) => setTimeout(r, 4500));
    // dev-mode mint: raise the caliber count to 4 (aria-labelled ▲ steppers) then MINT once
    for (let k = 0; k < 3; k++) {
      await page.evaluate(() => {
        const up = [...document.querySelectorAll('button[aria-label]')].find((x) => /increment|▲|up/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.innerText || '')));
        if (up) up.click();
      });
      await new Promise((r) => setTimeout(r, 350));
    }
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /mint/i.test(x.innerText) && !/view/i.test(x.innerText)); if (b) b.click(); });
    await new Promise((r) => setTimeout(r, 3500));
    // backup: second MINT in case count didn't take
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /mint/i.test(x.innerText) && !/view/i.test(x.innerText)); if (b) b.click(); });
    await new Promise((r) => setTimeout(r, 3200));
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /matrix/i.test(x.innerText)); if (b) b.click(); });
    await new Promise((r) => setTimeout(r, 7000));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const stats = await page.evaluate(() => {
    const consoles = [...document.querySelectorAll('.device-console')];
    const tops = consoles.map((c) => Math.round(c.getBoundingClientRect().top));
    const uniqTops = [...new Set(tops)].sort((a, b) => a - b);
    const firstRow = consoles.filter((c) => Math.abs(c.getBoundingClientRect().top - uniqTops[0]) < 4);
    let sameRow = null;
    if (firstRow.length >= 2) {
      const a = firstRow[0].getBoundingClientRect(), b = firstRow[1].getBoundingClientRect();
      sameRow = { sameTop: Math.abs(a.top - b.top) < 6, separated: b.left - a.right > -6, w1: Math.round(a.width), w2: Math.round(b.width) };
    }
    const oneConsole = consoles[0];
    const sockets = oneConsole ? [...oneConsole.querySelectorAll('.keycap-socket')] : [];
    let cols = 0;
    if (sockets.length) {
      const t = sockets[0].getBoundingClientRect().top;
      cols = sockets.filter((s) => Math.abs(s.getBoundingClientRect().top - t) < 4).length;
    }
    const btn = sockets[0] && sockets[0].querySelector('.keycap-btn');
    const keyH = btn ? parseInt(getComputedStyle(btn).height, 10) : 0;
    const vw = document.documentElement.clientWidth;
    const badOver = [...document.querySelectorAll('.device-console, .device-console *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 2 || r.left < -2);
    }).length;
    return { consoles: consoles.length, firstRowCount: firstRow.length, sameRow, sockets: sockets.length, cols, keyH, badOver, screws: document.querySelectorAll('.screw-bolt').length };
  });
  await page.screenshot({ path: shot });
  return stats;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

    // ── desktop pass ──
    const d = await enterAndDeck(page, 1440, 900, 'ui-deck2-desktop.png');
    check('desktop: >=2 consoles rendered in rack', d.consoles >= 2, `found=${d.consoles}, screws=${d.screws}`);
    check('desktop: 2 consoles per row (side by side)', !!d.sameRow && d.sameRow.sameTop && d.sameRow.separated, d.sameRow ? `sameTop=${d.sameRow.sameTop}, w=${d.sameRow.w1}/${d.sameRow.w2}` : `firstRow=${d.firstRowCount}`);
    check('desktop: keycap grid is 9 columns', d.cols === 9, `cols=${d.cols}, sockets=${d.sockets}`);
    check('desktop: keycap height 30px (rack default)', d.keyH === 30, `h=${d.keyH}px`);
    check('desktop: no console overflow beyond viewport', d.badOver === 0, `bad=${d.badOver}`);

    // ── mobile 390 pass ──
    const m = await browser.newPage();
    m.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
    const m1 = await enterAndDeck(m, 390, 844, 'ui-deck2-mobile.png');
    check('mobile 390: >=2 consoles rendered', m1.consoles >= 2, `found=${m1.consoles}`);
    check('mobile 390: 2 consoles per row preserved', !!m1.sameRow && m1.sameRow.sameTop && m1.sameRow.separated && m1.sameRow.w1 > 100, m1.sameRow ? `sameTop=${m1.sameRow.sameTop}, w=${m1.sameRow.w1}/${m1.sameRow.w2}` : 'n/a');
    check('mobile 390: keycap grid is 9 columns', m1.cols === 9, `cols=${m1.cols}`);
    check('mobile 390: keycap height shrunk (20px @390, both media tiers)', m1.keyH === 20, `h=${m1.keyH}px`);
    const mOver1 = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('mobile 390: no horizontal page overflow', mOver1 <= 2, `delta=${mOver1}px`);

    // ── mobile 320 pass ──
    const p2 = await browser.newPage();
    p2.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
    const m2 = await enterAndDeck(p2, 320, 568, 'ui-deck2-mobile320.png');
    check('mobile 320: >=2 consoles rendered', m2.consoles >= 2, `found=${m2.consoles}`);
    check('mobile 320: keycap grid is 9 columns', m2.cols === 9, `cols=${m2.cols}`);
    check('mobile 320: keycap height shrunk (20px @≤460px)', m2.keyH === 20, `h=${m2.keyH}px`);
    check('mobile 320: all 27 sockets per console present', m2.sockets === 27, `sockets=${m2.sockets}`);

    const fatal = errors.filter((e) => !/session-state|draw|favicon|net::|hydrat/i.test(e));
    check('no fatal page errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));
    console.log(results.join('\n'));
  } finally { await browser.close(); }
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(2);
})();
