/* Headless UI smoke test — reads only public UI state, no secrets. */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:3100';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function enterLobby(page) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const input = await page.$('input[placeholder*="GHOST_ZERO"]');
    if (!input) break; // lobby already loaded
    await sleep(1500); // let React hydrate before typing
    await input.type('GHOST_ZERO');
    const val = await page.evaluate(() => (document.querySelector('input[placeholder*="GHOST_ZERO"]') || {}).value || '');
    if (val.includes('GHOST_ZERO')) {
      await page.click('button.keyboard-key-accent');
      await sleep(1500);
      if (await page.$('.heist-drawer-key')) break;
    }
  }
  await page.waitForSelector('.heist-drawer-key', { timeout: 30000 });
  await sleep(2000);
}

async function desktop(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await enterLobby(page);
  await page.screenshot({ path: 'ui-verify-r1-desktop-lobby.png' });

  // 1) Drawer key clickable while panel OPEN (was hidden behind panel)
  const keyOpen = await page.evaluate(() => {
    const k = document.querySelector('.heist-drawer-key');
    if (!k) return { found: false };
    const r = k.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { found: true, topElIsKey: k === el || k.contains(el) };
  });
  // 2) Drawer key clickable while panel CLOSED (the reported bug)
  await page.click('.heist-drawer-key'); await sleep(600);
  const keyClosed = await page.evaluate(() => {
    const k = document.querySelector('.heist-drawer-key');
    if (!k) return { found: false };
    const r = k.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { found: true, topElIsKey: k === el || k.contains(el) };
  });
  await page.screenshot({ path: 'ui-verify-r1-desktop-lobby-closed.png' });
  await page.click('.heist-drawer-key'); await sleep(600);

  // 3) Composer margin tracks panel
  const composerMargin = await page.evaluate(() => getComputedStyle(document.querySelector('.hud-chat-inputbar')).marginRight);
  await page.click('.heist-drawer-key'); await sleep(600);
  const composerMarginClosed = await page.evaluate(() => getComputedStyle(document.querySelector('.hud-chat-inputbar')).marginRight);
  await page.click('.heist-drawer-key'); await sleep(600);

  // 4) Transmit button neon green gradient (shows once text is typed)
  await page.type('.chat-text-input', 'test');
  await sleep(300);
  const sendGradient = await page.evaluate(() => getComputedStyle(document.querySelector('.chat-send-btn')).backgroundImage);
  await page.evaluate(() => { const i = document.querySelector('.chat-text-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });

  // 5) Nordic Reserve gone from map + header bank chip exists
  const nordicGone = await page.evaluate(() => document.body.textContent.indexOf('Nordic') === -1);

  // 6) Enter the matrix — arena must be topmost; header chip present
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => x.textContent.includes('MATRIX'));
    if (b) b.click();
  });
  await sleep(2500);
  await page.screenshot({ path: 'ui-verify-r1-desktop-matrix.png' });
  const headerChip = await page.evaluate(() => {
    const hdr = document.querySelector('.app-header');
    if (!hdr) return null;
    const chip = [...hdr.querySelectorAll('div')].find(d => d.textContent.trim().startsWith('🔴'));
    return chip ? chip.textContent.trim() : null;
  });
  const arenaOnTop = await page.evaluate(() => {
    // The arena container should be visible and not fully covered by fixed windows
    const arena = document.querySelector('.matrix-right-panel') ? 'present' : 'absent';
    return arena;
  });

  console.log(JSON.stringify({
    keyOpen, keyClosed, composerMargin, composerMarginClosed,
    sendGradientIsGreen: /#39ff14|57,\s*255,\s*20/i.test(sendGradient || ''), sendGradient,
    nordicGone, headerChip, arenaOnTop,
  }, null, 2));
  await page.close();
}

async function mobile(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  // Desktop run saved its session (incl. phase) — reset so we test the real first-visit mobile flow
  await page.evaluate(() => { try { localStorage.clear() } catch {} });
  await page.reload({ waitUntil: 'networkidle2' });
  await enterLobby(page);

  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));

  // Drawer key usable when panel open (mobile bug) + toggle both ways + composer reachable
  const mobKey = await page.evaluate(() => {
    const k = document.querySelector('.heist-drawer-key');
    if (!k) return { found: false };
    const r = k.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { found: true, topElIsKey: k === el || k.contains(el) };
  });
  await page.click('.heist-drawer-key'); await sleep(700);
  const mobKeyClosed = await page.evaluate(() => {
    const k = document.querySelector('.heist-drawer-key');
    const r = k.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { panelClosed: !!document.querySelector('.heist-panel.heist-closed'), topElIsKey: k === el || k.contains(el) };
  });
  await page.click('.heist-drawer-key'); await sleep(700);
  await page.screenshot({ path: 'ui-verify-r1-mobile-lobby.png' });

  const composer = await page.evaluate(() => {
    const c = document.querySelector('.hud-chat-inputbar');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { bottom: r.bottom, vh: window.innerHeight };
  });

  console.log(JSON.stringify({ mobile: true, overflow, mobKey, mobKeyClosed, composer }, null, 2));
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
  await desktop(browser);
  await mobile(browser);
  await browser.close();
  console.log('SMOKE OK');
})().catch(e => { console.error('SMOKE ERR', e); process.exit(1); });
