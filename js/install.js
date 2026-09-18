/* ── Add to Home Screen / bookmark ─────────────────────────────────
   Students who put Semester HQ on their home screen come back far more
   often, and on iPhone it's also what makes reminders work. This picks
   the right ask for the device:
   - Chrome, Edge, Android: a real "Install" button (beforeinstallprompt)
   - iPhone and iPad: Share, then Add to Home Screen
   - Android browsers without the install event: menu, then Add to Home screen
   - Desktop Safari: File, then Add to Dock
   - Other desktop browsers: bookmark it with ⌘D or Ctrl+D
   The dashboard card appears once someone has started using the app
   (a class added, second visit or later), never inside the marketing
   site's demo, and stays away for a month after "Not now".
──────────────────────────────────────────────────────────────── */
const INSTALL_KEY = 'shq_install';
let _installEvent = null;

function installInfo() { try { return JSON.parse(localStorage.getItem(INSTALL_KEY) || '{}') || {}; } catch { return {}; } }
function saveInstallInfo(patch) { try { localStorage.setItem(INSTALL_KEY, JSON.stringify({ ...installInfo(), ...patch })); } catch {} }
function isStandaloneApp() { return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: minimal-ui)').matches || navigator.standalone === true; }
function installPlatform() {
  const ua = navigator.userAgent;
  if (_installEvent) return 'prompt';
  if (/Android/i.test(ua)) return 'android';
  // iPadOS reports itself as a Mac, so a touchscreen "Mac" is an iPad.
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) return 'mac-safari';
  return 'desktop';
}
function isMobileDevice() { return ['ios', 'android'].includes(installPlatform()) || (_installEvent && /Android|Mobi/i.test(navigator.userAgent)); }

function initInstallPrompt() {
  const info = installInfo();
  saveInstallInfo({ visits: (info.visits || 0) + 1, firstSeen: info.firstSeen || Date.now() });
  if (isStandaloneApp() && !info.installed) saveInstallInfo({ installed: Date.now() });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _installEvent = e;
    if (typeof renderRemote === 'function' && state.route === 'dashboard') renderRemote();
  });
  window.addEventListener('appinstalled', () => {
    _installEvent = null;
    saveInstallInfo({ installed: Date.now() });
    closeModal();
    toast('Semester HQ is on your home screen now', 'success', 4000);
    if (typeof render === 'function') render();
  });
}

function shouldShowInstallCard() {
  if (isEmbedded() || isStandaloneApp()) return false;
  const info = installInfo();
  if (info.installed || info.bookmarked) return false;
  if (info.dismissedAt && Date.now() - info.dismissedAt < 30 * 86400000) return false;
  const engaged = activeCourses().some(c => !c.sample) || state.assignments.some(a => !a.sample);
  return engaged && (info.visits || 0) >= 2;
}
function installCopy() {
  const p = installPlatform();
  if (p === 'prompt') return isMobileDevice()
    ? { title: 'Put Semester HQ on your home screen', sub: 'One tap to open, works offline, and reminders arrive even when it’s closed.', action: 'Install' }
    : { title: 'Install Semester HQ on this computer', sub: 'It opens in its own window from your dock or taskbar, like any other app.', action: 'Install' };
  if (p === 'ios') return { title: 'Add Semester HQ to your Home Screen', sub: 'It opens like an app, works offline, and it’s what turns on reminders on iPhone.', action: 'Show me how' };
  if (p === 'android') return { title: 'Put Semester HQ on your home screen', sub: 'One tap to open, works offline, and reminders arrive even when it’s closed.', action: 'Show me how' };
  if (p === 'mac-safari') return { title: 'Keep Semester HQ in your Dock', sub: 'Add it to your Dock and it opens in its own window, one click away.', action: 'Show me how' };
  return { title: 'Bookmark Semester HQ', sub: `Press ${isMac() ? '⌘D' : 'Ctrl+D'} so your semester is one click away, or install it if your browser offers.`, action: 'Show me how' };
}
function installPromptCard() {
  if (!shouldShowInstallCard()) return '';
  const c = installCopy();
  return `
    <div class="card install-card" role="region" aria-label="${esc(c.title)}">
      <img class="install-icon" src="${esc(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || 'assets/icon-192.png')}" alt="" width="46" height="46">
      <div class="install-copy">
        <div class="sg-strong">${esc(c.title)}</div>
        <div class="small muted">${esc(c.sub)}</div>
      </div>
      <div class="install-actions">
        <button class="btn btn-primary btn-sm" onclick="startInstall()">${installPlatform() === 'prompt' ? icon('download', 13, 2) + ' ' : ''}${esc(c.action)}</button>
        <button class="btn btn-ghost btn-sm" onclick="dismissInstallCard()">Not now</button>
      </div>
    </div>`;
}
function dismissInstallCard() {
  saveInstallInfo({ dismissedAt: Date.now() });
  touch();
  toast('You can do this any time from Settings.', 'info', 3500);
}
async function startInstall() {
  if (_installEvent) {
    const e = _installEvent;
    _installEvent = null;
    try {
      e.prompt();
      const choice = await e.userChoice;
      if (choice?.outcome === 'accepted') saveInstallInfo({ installed: Date.now() });
      else saveInstallInfo({ dismissedAt: Date.now() });
    } catch { openInstallHelp(); }
    render();
    return;
  }
  openInstallHelp();
}

const shareGlyph = () => `<span class="install-glyph" aria-hidden="true">${icon('share', 15, 1.9)}</span>`;
// The steps for this exact device, shared by the help modal and the last
// screen of semester setup.
function installGuide() {
  const p = installPlatform();
  const step = (n, html) => `<li class="install-step"><span class="install-num">${n}</span><div>${html}</div></li>`;
  let title, steps, note = '';
  if (isStandaloneApp()) {
    title = 'You’re already using the app';
    steps = [step(1, 'Semester HQ is open from your home screen or dock. Nothing else to do.')];
  } else if (p === 'ios') {
    const nonSafari = /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    title = 'Add to your Home Screen';
    steps = [
      step(1, `Tap the <strong>Share</strong> button ${shareGlyph()} ${nonSafari ? 'in the address bar' : 'at the bottom of Safari (at the top on iPad)'}.`),
      step(2, `Scroll down and tap <strong>Add to Home Screen</strong> <span class="install-glyph" aria-hidden="true">${icon('plus', 14, 2)}</span>.`),
      step(3, 'Tap <strong>Add</strong>. Open Semester HQ from your Home Screen from now on.'),
    ];
    note = 'Opening it from your Home Screen is what lets reminders show up on iPhone. Turn them on in Settings after.';
  } else if (p === 'android') {
    title = 'Add to your home screen';
    steps = [
      step(1, `Tap the <strong>menu</strong> <span class="install-glyph" aria-hidden="true">⋮</span> in your browser.`),
      step(2, 'Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.'),
      step(3, 'Tap <strong>Install</strong> or <strong>Add</strong>. It shows up with your other apps.'),
    ];
  } else if (p === 'mac-safari') {
    title = 'Add Semester HQ to your Dock';
    steps = [
      step(1, 'In the menu bar, click <strong>File</strong>.'),
      step(2, 'Click <strong>Add to Dock</strong>, then <strong>Add</strong>.'),
      step(3, `Or bookmark it instead: press <kbd>⌘</kbd> <kbd>D</kbd>.`),
    ];
  } else {
    title = 'Keep Semester HQ one click away';
    steps = [
      step(1, `Press <kbd>${isMac() ? '⌘' : 'Ctrl'}</kbd> <kbd>D</kbd> to bookmark this page.`),
      step(2, 'Choose your bookmarks bar so it’s always visible.'),
      step(3, `Using Chrome or Edge? Look for the install icon <span class="install-glyph" aria-hidden="true">${icon('download', 14, 2)}</span> at the right end of the address bar to get it as an app.`),
    ];
  }
  return { platform: p, title, steps, note };
}
function openInstallHelp() {
  const { platform: p, title, steps, note } = installGuide();
  openModal(`
    <div class="modal-head"><h3>${esc(title)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <ol class="install-steps">${steps.join('')}</ol>
      ${note ? `<p class="small muted mt-8">${esc(note)}</p>` : ''}
    </div>
    <div class="modal-foot">
      ${!isStandaloneApp() && (p === 'desktop' || p === 'mac-safari') ? `<button class="btn" onclick="markBookmarked()">I bookmarked it</button>` : ''}
      ${!isStandaloneApp() && (p === 'ios' || p === 'android') ? `<button class="btn" onclick="markInstalledByHand()">I added it</button>` : ''}
      <button class="btn btn-primary" onclick="closeModal()">Got it</button>
    </div>
  `);
}
// Shown at the end of semester setup: the one moment everyone reaches, and
// the students who put Semester HQ on their home screen are the ones who
// keep using it (on iPhone it's also what lets reminders through).
function installSetupCard() {
  // Shown to everyone finishing setup who isn't already in the app, even if
  // they waved off the floating prompt earlier: this is the screen where
  // "put it on your home screen" actually lands, and it's the step people
  // ask for by name.
  if (isEmbedded() || isStandaloneApp()) return '';
  const { platform: p, title, steps, note } = installGuide();
  return `
    <div class="card card-pad setup-install">
      <div class="setup-install-head">
        <img class="install-icon" src="${esc(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || 'assets/icon-192.png')}" alt="" width="40" height="40">
        <div><div class="sg-strong">${esc(title)}</div><div class="small muted">${p === 'ios' ? 'Two taps, and it opens like any other app.' : 'Keep your semester one tap away.'}</div></div>
      </div>
      <ol class="install-steps mt-8">${steps.join('')}</ol>
      ${note ? `<p class="small muted">${esc(note)}</p>` : ''}
      <div class="flex-gap wrap mt-8">
        ${p === 'prompt' ? `<button class="btn btn-sm btn-primary" onclick="startInstall()">${icon('download', 13, 2)} Install</button>` : ''}
        ${p === 'ios' || p === 'android' ? `<button class="btn btn-sm" onclick="markInstalledByHand()">I added it</button>` : ''}
        ${p === 'desktop' || p === 'mac-safari' ? `<button class="btn btn-sm" onclick="markBookmarked()">I bookmarked it</button>` : ''}
      </div>
    </div>`;
}
// Called from the help modal and from semester setup's last screen, which
// is itself a modal: closing that one would throw away the finish screen,
// so there it just re-renders without the install card.
function dismissInstallStep() {
  if (window._setup && document.querySelector('.setup-body')) { renderSetupStep(); return; }
  closeModal();
  touch();
}
function markBookmarked() { saveInstallInfo({ bookmarked: Date.now() }); dismissInstallStep(); toast('Nice. Your semester is one click away.'); }
function markInstalledByHand() { saveInstallInfo({ installed: Date.now() }); dismissInstallStep(); toast('Nice. Open it from your home screen from now on.'); }

function installSettingsCard() {
  if (isEmbedded()) return '';
  const standalone = isStandaloneApp();
  const c = installCopy();
  return `
    <div class="card card-pad">
      <h3 style="font-size:15px" class="mb-8">${standalone ? 'App' : installPlatform() === 'desktop' ? 'Bookmark or install' : 'Add to home screen'}</h3>
      ${standalone
        ? `<p class="small muted">You’re using Semester HQ as an app. It works offline, and reminders can reach you when it’s closed.</p>`
        : `<p class="small muted mb-8">${esc(c.sub)}</p><button class="btn btn-sm" onclick="startInstall()">${icon(installPlatform() === 'prompt' ? 'download' : 'share', 13, 1.9)} ${installPlatform() === 'prompt' ? 'Install Semester HQ' : 'Show me how'}</button>`}
    </div>`;
}
