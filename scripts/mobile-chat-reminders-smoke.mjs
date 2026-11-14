import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/reminders/login?__mobile_chat_reminders_smoke=1', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForSelector('#root', { timeout: 20000 });

  // The sign-in route is intentionally rendered without the authenticated
  // AppShell. Mount the exact mobile shell/dock classes as a deterministic UI
  // fixture so this test covers layout CSS without depending on auth state.
  await page.evaluate(() => {
    const root = document.querySelector('#root');
    if (!root) throw new Error('Vite application root is missing');
    root.replaceChildren();

    const shell = document.createElement('div');
    shell.className = 'app-shell is-touch-layout';
    shell.dir = 'rtl';
    const status = document.createElement('div');
    status.className = 'native-system-status';
    const header = document.createElement('header');
    header.className = 'app-mobilebar native-app-header';
    const title = document.createElement('span');
    title.textContent = 'Customs OS';
    header.append(title);
    const main = document.createElement('main');
    main.className = 'app-main';
    const content = document.createElement('div');
    content.className = 'app-content';
    const stage = document.createElement('div');
    stage.className = 'future-route-stage';
    content.append(stage);
    main.append(content);
    shell.append(status, header, main);
    root.append(shell);

    const dock = document.createElement('nav');
    dock.className = 'app-mobile-dock app-mobile-viewport-dock native-bottom-tabs';
    dock.setAttribute('aria-label', 'پیمایش اصلی برنامه');
    for (const label of ['خانه', 'یادآورها', 'عملیات', 'چت', 'بیشتر']) {
      const tab = document.createElement('button');
      tab.type = 'button';
      const span = document.createElement('span');
      span.textContent = label;
      tab.append(span);
      dock.append(tab);
    }
    document.body.append(dock);
  });

  const initial = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    const header = document.querySelector('.app-mobilebar.native-app-header');
    const dock = document.querySelector('.app-mobile-viewport-dock');
    return {
      touchShell: Boolean(shell?.classList.contains('is-touch-layout')),
      headerVisible: Boolean(header && getComputedStyle(header).display !== 'none'),
      dockVisible: Boolean(dock && getComputedStyle(dock).display !== 'none'),
      dockPosition: dock ? getComputedStyle(dock).position : 'missing',
      dockTabs: dock?.querySelectorAll('button').length ?? 0,
    };
  });
  assert.equal(initial.touchShell, true, JSON.stringify(initial));
  assert.equal(initial.headerVisible, true, JSON.stringify(initial));
  assert.equal(initial.dockVisible, true, JSON.stringify(initial));
  assert.equal(initial.dockPosition, 'fixed', JSON.stringify(initial));
  assert.equal(initial.dockTabs, 5, JSON.stringify(initial));

  // Mount the real reminder overlay classes on the production mobile shell and
  // emulate the reduced visual viewport reported while an iOS keyboard is open.
  await page.evaluate(() => {
    const stage = document.querySelector('.future-route-stage');
    if (!stage) throw new Error('Mobile route stage is missing');
    const reminderPage = document.createElement('main');
    reminderPage.className = 'reminders-page reminders-app-standalone';
    reminderPage.dir = 'rtl';

    const reminderHub = document.createElement('section');
    reminderHub.className = 'reminders-route-screen reminders-hub-screen';
    const reminderHeader = document.createElement('header');
    reminderHeader.className = 'reminders-hub-header';
    const headerActions = document.createElement('div');
    headerActions.className = 'reminders-hub-actions';
    const addAction = document.createElement('button');
    addAction.type = 'button';
    addAction.className = 'reminders-hub-add';
    addAction.setAttribute('aria-label', 'یادآور جدید');
    addAction.textContent = '+';
    headerActions.append(addAction);
    reminderHeader.append(headerActions);

    const overlay = document.createElement('form');
    overlay.className = 'reminders-composebar is-open';
    overlay.setAttribute('role', 'dialog');
    const sheet = document.createElement('div');
    sheet.className = 'reminders-compose-sheet';
    const heading = document.createElement('div');
    heading.className = 'reminders-compose-heading';
    heading.textContent = 'ثبت هوشمند';
    const input = document.createElement('textarea');
    input.className = 'reminders-smart-input';
    input.setAttribute('aria-label', 'متن یادآور');
    const details = document.createElement('div');
    details.style.height = '520px';
    details.textContent = 'فیلدهای بیشتر و جزئیات یادآور';
    const actions = document.createElement('div');
    actions.className = 'reminders-compose-actions';
    const submit = document.createElement('button');
    submit.className = 'reminders-submit-button';
    submit.type = 'submit';
    submit.textContent = 'ثبت یادآور';
    actions.append(submit);
    sheet.append(heading, input, details, actions);
    overlay.append(sheet);
    reminderHub.append(reminderHeader);
    reminderPage.append(reminderHub, overlay);
    stage.append(reminderPage);

    document.documentElement.style.setProperty('--reminder-visual-top', '18px');
    document.documentElement.style.setProperty('--reminder-visual-height', '360px');
  });

  const measureReminder = async () => page.evaluate(() => {
    const overlay = document.querySelector('.reminders-composebar.is-open');
    const sheet = document.querySelector('.reminders-compose-sheet');
    const submit = document.querySelector('.reminders-submit-button');
    const addAction = document.querySelector('.reminders-hub-add');
    const dock = document.querySelector('.app-mobile-viewport-dock');
    const rect = element => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    };
    const dockRect = rect(dock);
    const addActionRect = rect(addAction);
    return {
      overlay: rect(overlay),
      sheet: rect(sheet),
      sheetMaxHeight: parseFloat(getComputedStyle(sheet).maxHeight) || 0,
      sheetOverflowY: getComputedStyle(sheet).overflowY,
      submit: rect(submit),
      addAction: addActionRect,
      addActionDisplay: addAction ? getComputedStyle(addAction).display : 'missing',
      dock: dockRect,
      addActionDockClearance: dockRect && addActionRect ? Math.round(dockRect.top - addActionRect.bottom) : -999,
    };
  });

  const first = await measureReminder();
  assert.equal(first.overlay?.top, 18, JSON.stringify(first));
  assert.equal(first.overlay?.height, 360, JSON.stringify(first));
  assert.ok(first.sheet?.height <= 342, JSON.stringify(first));
  assert.equal(first.sheetOverflowY, 'auto', JSON.stringify(first));
  assert.ok(first.addAction?.height >= 40, JSON.stringify(first));
  assert.notEqual(first.addActionDisplay, 'none', JSON.stringify(first));
  assert.ok(first.addActionDockClearance > 0, JSON.stringify(first));

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--reminder-visual-top', '24px');
    document.documentElement.style.setProperty('--reminder-visual-height', '260px');
    const sheet = document.querySelector('.reminders-compose-sheet');
    if (sheet) sheet.scrollTop = sheet.scrollHeight;
  });
  const compact = await measureReminder();
  assert.equal(compact.overlay?.top, 24, JSON.stringify(compact));
  assert.equal(compact.overlay?.height, 260, JSON.stringify(compact));
  assert.ok(compact.sheet?.height <= 242, JSON.stringify(compact));
  assert.ok(compact.submit?.bottom <= (compact.sheet?.bottom ?? -1) + 1, JSON.stringify(compact));
  assert.ok(compact.addActionDockClearance > 0, JSON.stringify(compact));

  // Recreate the chat flex chain; the body-portal dock must stay below the
  // message composer, and large attachment previews must remain bounded.
  await page.evaluate(() => {
    const shell = document.createElement('div');
    shell.className = 'app-shell is-touch-layout is-chat-route';
    const status = document.createElement('div');
    status.className = 'native-system-status';
    const header = document.createElement('header');
    header.className = 'app-mobilebar native-app-header';
    const main = document.createElement('main');
    main.className = 'app-main is-chat-main';
    const content = document.createElement('div');
    content.className = 'app-content is-chat-content';
    const stage = document.createElement('div');
    stage.className = 'future-route-stage is-chat-stage';
    const chat = document.createElement('div');
    chat.className = 'chat-standalone';
    chat.dataset.chatSelected = 'true';
    const conversation = document.createElement('section');
    conversation.className = 'chat-conversation-view';
    const conversationHeader = document.createElement('header');
    conversationHeader.className = 'chat-conversation-header';
    const messages = document.createElement('div');
    messages.className = 'chat-message-area';
    messages.style.height = '200px';
    const composer = document.createElement('div');
    composer.className = 'chat-composer';
    composer.style.height = '76px';
    const previews = document.createElement('section');
    previews.dataset.unsaved = 'true';
    previews.style.height = '360px';
    composer.append(previews);
    conversation.append(conversationHeader, messages, composer);
    chat.append(conversation);
    stage.append(chat);
    content.append(stage);
    main.append(content);
    shell.append(status, header, main);
    document.body.append(shell);
  });
  await page.waitForTimeout(50);
  const chat = await page.evaluate(() => {
    const composer = document.querySelector('.app-shell.is-chat-route .chat-composer');
    const dock = document.querySelector('.app-mobile-viewport-dock');
    const previews = document.querySelector('.app-shell.is-chat-route .chat-composer [data-unsaved="true"]');
    const rect = element => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    };
    return {
      composer: rect(composer),
      dock: rect(dock),
      clearance: composer && dock ? Math.round(dock.getBoundingClientRect().top - composer.getBoundingClientRect().bottom) : -999,
      previewMaxHeight: previews ? parseFloat(getComputedStyle(previews).maxHeight) || 0 : 0,
      previewOverflowY: previews ? getComputedStyle(previews).overflowY : 'missing',
    };
  });
  assert.ok(chat.clearance >= 0, JSON.stringify(chat));
  assert.ok(chat.previewMaxHeight <= 140, JSON.stringify(chat));
  assert.equal(chat.previewOverflowY, 'auto', JSON.stringify(chat));
  assert.equal(errors.length, 0, errors.join(' | '));
  console.log('Mobile chat/reminder viewport smoke passed:', JSON.stringify({ first, compact, chat }));
} finally {
  await browser.close();
}
