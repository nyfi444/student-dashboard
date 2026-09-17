/* ── Quick capture ─────────────────────────────────────────────────
   Snap a photo of a whiteboard or assignment sheet (or drop in a PDF,
   screenshot, or pasted text) and it becomes assignments, exams, and
   to-dos, matched to the right class. On Android, sharing a file or link
   to Semester HQ from any app lands here too (see the share_target in
   manifest.json and the share handler in sw.js).
──────────────────────────────────────────────────────────────── */
const CAPTURE_SYSTEM = `You turn a photo, screenshot, or text from a college student's class (a whiteboard, an assignment sheet, a syllabus page, a slide, an email) into a list of things to track. Reply with ONLY a JSON object (no prose, no markdown fences):
{"items": [{"kind": "assignment"|"exam"|"todo", "title": string, "courseCode": string, "type": "assignment"|"reading"|"discussion"|"quiz"|"exam"|"project"|"paper"|"lab", "dueDate": "YYYY-MM-DD or empty string", "dueTime": "HH:MM or empty string", "notes": string}]}
Rules: "assignment" and "exam" are graded coursework with a due date; "todo" is any other action ("email the professor", "buy lab goggles"). courseCode must be one of the student's course codes listed below when you can tell which class it belongs to, otherwise an empty string. Resolve relative dates ("next Friday", "due Tuesday") using today's date. Keep titles short and specific. Put useful extra detail (page numbers, length, format) in notes. Do not invent items that aren't there. If nothing actionable is present, return {"items": []}.`;

function openQuickCapture({ files = [], text = '' } = {}) {
  if (!requireAi('Quick capture')) return;
  window._capture = { files: [], text, items: null };
  renderCaptureInput();
  if (files.length) addCaptureFiles(files);
}
function renderCaptureInput() {
  const c = window._capture;
  openModal(`
    <div class="modal-head"><h3>Quick capture <span class="ai-badge">AI</span></h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-16">Snap a whiteboard, an assignment sheet, or a slide, or paste an email. Semester HQ pulls out what’s due and which class it’s for.</p>
      <div class="capture-drop" id="capture-drop" ondragover="event.preventDefault();this.classList.add('drag')" ondragleave="this.classList.remove('drag')" ondrop="event.preventDefault();this.classList.remove('drag');addCaptureFiles(event.dataTransfer.files)">
        ${c.files.length ? `<div class="capture-thumbs">${c.files.map((f, i) => `
          <div class="capture-thumb">${f.preview ? `<img src="${f.preview}" alt="">` : `<span class="capture-file">${icon('file-text', 18, 1.6)}<span>${esc(f.name)}</span></span>`}
            <button class="capture-thumb-x" aria-label="Remove ${esc(f.name)}" onclick="window._capture.files.splice(${i},1);renderCaptureInput()">${icon('x', 11, 2.4)}</button></div>`).join('')}</div>`
        : `<span class="capture-drop-ic">${icon('camera', 26, 1.5)}</span><div class="sg-strong">Add a photo, screenshot, or file</div><div class="small muted">Drop files here, or</div>`}
        <div class="flex-gap wrap" style="justify-content:center">
          <label class="btn btn-sm btn-primary">${icon('camera', 13, 1.8)} Take a photo<input type="file" accept="image/*" capture="environment" hidden onchange="addCaptureFiles(this.files)"></label>
          <label class="btn btn-sm">${icon('upload', 13, 1.8)} Choose files<input type="file" multiple hidden onchange="addCaptureFiles(this.files)"></label>
        </div>
      </div>
      <div class="field mt-16" style="margin-bottom:0"><label for="capture-text">Or paste text</label><textarea class="input" id="capture-text" placeholder="“Problem set 5 due next Friday, quiz on chapters 6–7 Wednesday…”" oninput="window._capture.text=this.value">${esc(c.text)}</textarea></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="capture-go" onclick="runQuickCapture()">${icon('sparkles', 13, 1.5)} Find what’s due</button></div>
  `, { wide: true });
}
async function addCaptureFiles(fileList) {
  const list = Array.from(fileList || []).slice(0, 8);
  for (const f of list) {
    if (f.size > UPLOAD_MAX_BYTES) { toast(`${f.name} is too large (60 MB max)`, 'error'); continue; }
    const entry = { name: f.name, type: f.type, file: f, preview: null };
    // A photo this browser can't show (an iPhone photo in Chrome) still gets
    // read; it just shows as a file tile here.
    if (/^image\//.test(f.type)) entry.preview = await downscaleImage(f, 360, 0.7);
    window._capture.files.push(entry);
  }
  if ($('#capture-drop')) renderCaptureInput();
}
async function runQuickCapture() {
  const c = window._capture;
  const text = (c.text || '').trim();
  if (!c.files.length && text.length < 4) { toast('Add a photo, a file, or some text first', 'error'); return; }
  const btn = $('#capture-go');
  setBtnLoading(btn, true);
  try {
    let images = [], extraText = '';
    if (c.files.length) {
      try {
        const got = await readUploadedFiles(c.files.map(f => f.file), { pdfPages: 4 });
        images = got.images;
        extraText = got.text;
        toastUploadProblems(got);
      } catch (e) {
        // None of the files could be read, but there's typed text to go on.
        if (text.length < 4) throw e;
        toast(e.message, 'info', 6000);
      }
    }
    const courses = activeCourses().map(x => `${x.code || x.name} = ${x.name}`).join('; ') || 'none';
    const intro = `Today is ${todayIso()} (${fmtDate(todayIso(), { weekday: 'long' })}). The student's courses: ${courses}.`;
    const body = `${intro}${text ? `\n\nText:\n${text}` : ''}${extraText ? `\n\nDocument text:\n${extraText.slice(0, 14000)}` : ''}`;
    const userContent = images.length ? [...imageBlocks(images.slice(0, 8)), { type: 'text', text: body }] : body;
    const raw = await callClaude({ system: CAPTURE_SYSTEM, userContent, maxTokens: 2500 });
    const parsed = extractJson(raw);
    const items = (Array.isArray(parsed.items) ? parsed.items : []).filter(x => x && x.title).slice(0, 40).map(x => {
      const course = activeCourses().find(k => [k.code, k.name].filter(Boolean).some(v => v.toLowerCase() === String(x.courseCode || '').toLowerCase()));
      const kind = ['assignment', 'exam', 'todo'].includes(x.kind) ? x.kind : 'todo';
      return {
        include: true, kind, title: String(x.title).slice(0, 160), courseId: course?.id || '',
        type: kind === 'exam' ? 'exam' : ASSIGNMENT_TYPES.includes(x.type) ? x.type : 'assignment',
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(x.dueDate || '') ? x.dueDate : '', dueTime: /^\d{2}:\d{2}$/.test(x.dueTime || '') ? x.dueTime : '', notes: String(x.notes || '').slice(0, 500),
      };
    });
    if (!items.length) { setBtnLoading(btn, false); toast('Didn’t find anything due in that. Try a clearer photo or add some text.', 'info', 5000); return; }
    c.items = items;
    renderCaptureReview();
  } catch (e) {
    setBtnLoading(btn, false);
    toast(e.message || 'Couldn’t read that', 'error', 5000);
  }
}
function renderCaptureReview() {
  const c = window._capture;
  const count = c.items.filter(i => i.include).length;
  const courses = activeCourses();
  openModal(`
    <div class="modal-head"><h3>Here’s what I found</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-16">Check the details, then add them. Uncheck anything you don’t want.</p>
      ${c.items.map((it, i) => `
        <div class="capture-item ${it.include ? '' : 'is-off'}">
          <button type="button" class="row-check ${it.include ? 'checked' : ''}" role="checkbox" aria-checked="${it.include}" aria-label="Include ${esc(it.title)}" onclick="window._capture.items[${i}].include=!window._capture.items[${i}].include;renderCaptureReview()">${it.include ? checkGlyph(true) : ''}</button>
          <div class="capture-fields">
            <input class="input capture-title" value="${esc(it.title)}" aria-label="Title" oninput="window._capture.items[${i}].title=this.value">
            <div class="capture-meta">
              <select class="select" aria-label="Kind" onchange="window._capture.items[${i}].kind=this.value;if(this.value==='exam')window._capture.items[${i}].type='exam'">${[['assignment', 'Assignment'], ['exam', 'Exam'], ['todo', 'To-do']].map(([v, l]) => `<option value="${v}" ${v === it.kind ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <select class="select" aria-label="Class" onchange="window._capture.items[${i}].courseId=this.value"><option value="">No class</option>${courses.map(k => `<option value="${k.id}" ${k.id === it.courseId ? 'selected' : ''}>${esc(k.code || k.name)}</option>`).join('')}</select>
              <input class="input" type="date" value="${esc(it.dueDate)}" aria-label="Due date" oninput="window._capture.items[${i}].dueDate=this.value">
              <input class="input" type="time" value="${esc(it.dueTime)}" aria-label="Due time" oninput="window._capture.items[${i}].dueTime=this.value">
            </div>
            ${it.notes ? `<div class="small muted">${esc(it.notes)}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" style="margin-right:auto" onclick="renderCaptureInput()">${icon('arrow-left', 13, 1.9)} Back</button><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="commitCapture()" ${count ? '' : 'disabled'}>Add ${count} item${count === 1 ? '' : 's'}</button></div>
  `, { wide: true });
}
function commitCapture() {
  const chosen = dropRepeats(window._capture.items.filter(i => i.include && i.title.trim()));
  const duplicates = chosen.filter(it => it.kind === 'todo' || !it.courseId ? findDuplicateTodo(it.title) : findDuplicateAssignment(it.title, it.courseId));
  askAboutDuplicates(duplicates, chosen.length, 'item', (skip) => commitCaptureItems(skip ? chosen.filter(it => !duplicates.includes(it)) : chosen, chosen.length));
}
function commitCaptureItems(items, chosenCount) {
  let assignments = 0, todos = 0;
  items.forEach(it => {
    if (it.kind === 'todo' || !it.courseId) {
      state.todos.unshift({ id: uid(), courseId: it.courseId || null, title: it.title.trim(), done: false, dueDate: it.dueDate || null, priority: 'medium', recurring: null, notes: it.notes || '' });
      todos++;
    } else {
      state.assignments.push({
        id: uid(), courseId: it.courseId, title: it.title.trim(), type: it.kind === 'exam' ? 'exam' : it.type, dueDate: it.dueDate || null, dueTime: it.dueTime || '23:59',
        startByDate: null, maxPoints: null, earnedPoints: null, status: 'not-started', rubric: [], notes: it.notes || '', attachments: [], recurringTemplateId: null,
      });
      assignments++;
    }
  });
  closeModal();
  touch();
  const skipped = chosenCount - items.length;
  if (!items.length) { toast('Nothing new to add, you already had these', 'info', 4000); return; }
  playUiSound('success');
  toast([assignments ? `${assignments} assignment${assignments === 1 ? '' : 's'}` : '', todos ? `${todos} to-do${todos === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') + ' added'
    + (skipped ? `, skipped ${skipped} you already had` : ''), 'success', skipped ? 4500 : 2600);
}

// Files or text shared into the installed app (Android share sheet). The
// service worker stashed them in a cache and reopened the app with ?shared=1.
async function handleSharedContent() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return;
  params.delete('shared');
  history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  try {
    const cache = await caches.open('shq-share');
    const metaRes = await cache.match('/share-target/meta');
    if (!metaRes) return;
    const meta = await metaRes.json();
    const files = [];
    for (let i = 0; i < (meta.files || []).length; i++) {
      const res = await cache.match(`/share-target/file-${i}`);
      if (res) files.push(new File([await res.blob()], meta.files[i].name || `shared-${i}`, { type: meta.files[i].type }));
    }
    await Promise.all((await cache.keys()).map(k => cache.delete(k)));
    const text = [meta.title, meta.text, meta.url].filter(Boolean).join('\n');
    setTimeout(() => whenAccountChecked(() => openQuickCapture({ files, text })), 300);
  } catch (e) { diag.warn('capture', 'Could not open shared content', e); }
}
