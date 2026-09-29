/* ── Spaces: forms, sending an answer ──────────────────────────────
   The three things that leave the device when someone answers a form,
   in one place because the app (js/spaces/forms.js) and the standalone
   fill-out page (js/form-page.js) both do them, each with its own
   Firebase connection:

   formSendAnswer(ctx, form, answers, { at, sent }) -> the stored answer
     A named form: files picked for file questions go to Storage first
     (formFilePath, one per question, under the sender's uid), then the
     answer and the sender's own record of it are written together.
     An anonymous form: nothing is written from here. The answers go to
     the Worker (/form/answer), which files them under a random id.
   formTakeBack(ctx, form)   remove my answer, and my files with it
   formFileUrl(ctx, formId, uid, questionId) -> a link that opens the file
     Made on the spot for whoever asks, and storage.rules decides whether
     they may: the sender, and the people running the form.

   ctx: { db, storage (async () => firebase.storage()), user, kind, code,
          name, member }
   A refused answer throws an Error; one the Worker sent back with
   per-question messages carries them as error.errors.
──────────────────────────────────────────────────────────────── */
function formFileQuestions(form) { return form.questions.filter(q => q.type === 'file'); }
function formResponsesRef(ctx, formId) { return ctx.db.collection(formCollection(ctx.kind)).doc(ctx.code).collection('forms').doc(formId).collection('responses'); }
function formMyRecordRef(ctx, formId) { return ctx.db.collection('planners').doc(ctx.user.uid).collection('formAnswers').doc(formAnswerKey(ctx.kind, ctx.code, formId)); }

async function formAskWorker(ctx, form, body) {
  const idToken = await ctx.user.getIdToken();
  let res;
  try { res = await fetch(`${WORKER_URL}/form/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken, kind: ctx.kind, code: ctx.code, formId: form.id, ...body }) }); }
  catch { throw new Error('Couldn’t send. Check your connection and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const err = new Error(data.error || 'That didn’t go through. Try again in a moment.');
  if (data.errors && typeof data.errors === 'object') err.errors = data.errors;
  err.status = res.status;
  throw err;
}
// sent: the answers already stored (so a file that was removed in the form
// is removed from Storage too). at: when the first answer was sent.
async function formSendAnswer(ctx, form, answers, { at = 0, sent = {} } = {}) {
  const now = Date.now();
  if (form.anonymous) {
    await formAskWorker(ctx, form, { answers });
    return { anon: true, answers, at: now, updatedAt: now };
  }
  const me = ctx.user.uid;
  const files = formFileQuestions(form);
  if (files.length) {
    const storage = await ctx.storage();
    for (const q of files) {
      const ref = storage.ref(formFilePath(ctx.kind, ctx.code, form.id, me, q.id));
      const picked = formFillPicked(q.id);
      if (picked) await ref.put(picked, storageFileMetadata(picked.name, picked.type));
      else if (sent[q.id] && !answers[q.id]) await ref.delete().catch(() => {});
    }
  }
  const data = { uid: me, name: ctx.name.slice(0, 80), member: !!ctx.member, answers, at: at || now, updatedAt: now, ...(form.collectEmail ? { email: ctx.user.email || '' } : {}) };
  const batch = ctx.db.batch();
  batch.set(formResponsesRef(ctx, form.id).doc(me), data);
  batch.set(formMyRecordRef(ctx, form.id), { kind: ctx.kind, code: ctx.code, formId: form.id, title: form.title, spaceName: form.spaceName || '', at: now });
  await batch.commit();
  return data;
}
async function formTakeBack(ctx, form) {
  if (form.anonymous) { await formAskWorker(ctx, form, { remove: true }); return; }
  const me = ctx.user.uid;
  const batch = ctx.db.batch();
  batch.delete(formResponsesRef(ctx, form.id).doc(me));
  batch.delete(formMyRecordRef(ctx, form.id));
  await batch.commit();
  await formDeleteFiles(ctx, form, me);
}
// Best effort: a file that is already gone is not a problem.
async function formDeleteFiles(ctx, form, uid) {
  const files = formFileQuestions(form);
  if (!files.length) return;
  try {
    const storage = await ctx.storage();
    await Promise.all(files.map(q => storage.ref(formFilePath(ctx.kind, ctx.code, form.id, uid, q.id)).delete().catch(() => {})));
  } catch (e) { diag.warn('forms', 'Form files could not be removed', e); }
}
async function formFileUrl(ctx, formId, uid, questionId) {
  return (await ctx.storage()).ref(formFilePath(ctx.kind, ctx.code, formId, uid, questionId)).getDownloadURL();
}
