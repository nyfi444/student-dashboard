/* ── Reading uploaded files ─────────────────────────────────────────
   Everything Semester HQ reads for you (a syllabus, an assignment sheet,
   quick capture, a study guide, flashcards, a note import) goes through
   this file, so every upload takes the same files: PDF, Word, PowerPoint,
   Excel, OpenDocument, RTF, web pages, plain text, Word and PowerPoint
   97–2003 files, and photos, iPhone HEIC photos included.

   No file picker in the app filters by type. A filter grays files out in
   the picker on a computer, iPad, or phone, so a student couldn't even
   select the Word syllabus they had. Anything can be picked now, and a
   file that can't be read says what to do instead.
──────────────────────────────────────────────────────────────── */
const UPLOAD_MAX_BYTES = 60 * 1024 * 1024;
const HEIC2ANY_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js';
const IMAGE_EXTS = ['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff'];
const TEXT_EXTS = ['txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'tex', 'log', 'srt', 'vtt', 'ics', 'yaml', 'yml', 'eml'];
const SPREADSHEET_EXTS = ['xlsx', 'xlsm', 'xltx', 'ods'];

// Several files for AI to read. Returns { text, images, problems }: the text
// of every document, images ({base64, mediaType}) of photos and scanned
// pages, and a sentence for each file that couldn't be read. Throws only
// when nothing at all could be read.
async function readUploadedFiles(fileList, { maxFiles = 8, maxImages = 8, pdfPages = 6 } = {}) {
  const files = Array.from(fileList || []);
  const texts = [], images = [], problems = [];
  for (const file of files.slice(0, maxFiles)) {
    try {
      const got = await readOneUpload(file, { pdfPages });
      const text = (got.text || '').trim();
      if (!text && !got.images?.length) throw new Error(`Couldn’t find anything to read in ${file.name}.`);
      if (text) texts.push(files.length > 1 ? `${file.name}\n${text}` : text);
      images.push(...(got.images || []));
      if (got.pagesLeftOut) problems.push(`Only the first ${pdfPages} pages of ${file.name} were read.`);
    } catch (e) {
      problems.push(e?.message || `Couldn’t read ${file.name}.`);
    }
  }
  if (files.length > maxFiles) problems.push(`Only the first ${maxFiles} files were read.`);
  if (images.length > maxImages) problems.push(`Only the first ${maxImages} pages and photos were read.`);
  if (!texts.length && !images.length) throw new Error(problems[0] || 'Couldn’t find anything to read in that file.');
  return { text: texts.join('\n\n'), images: images.slice(0, maxImages), problems };
}
function uploadReadySummary({ text, images }) {
  return [text ? `${text.length.toLocaleString()} characters` : '', images.length ? `${images.length} page${images.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') + ' ready';
}
function toastUploadProblems(result) {
  if (result?.problems?.length) toast(result.problems.join(' '), 'info', 7000);
}

// One file, whatever it is. `textOnly` skips photos and page images.
async function readOneUpload(file, { pdfPages = 6, textOnly = false } = {}) {
  const name = file.name || 'That file';
  if (!file.size) throw new Error(`${name} is empty.`);
  if (file.size > UPLOAD_MAX_BYTES) throw new Error(`${name} is too big to read (60 MB max). Save just the pages you need as a PDF, then upload that.`);
  const ext = fileExt(name);
  const known = unreadableByName(name, ext);
  if (known) throw new Error(known);
  const kind = await uploadKind(file);
  if (kind === 'pdf') return pdfUpload(file, { pdfPages, textOnly });
  if (kind === 'image') return textOnly ? { text: '' } : { images: [dataUrlToImage(await imageUploadDataUrl(file))] };
  if (kind === 'zip') return zipUpload(file, ext, { pdfPages, textOnly });
  if (kind === 'ole') return { text: compoundFileText(await openCompoundFile(file), name) };
  if (kind === 'rtf') return { text: rtfToText(await readTextUpload(file)) };
  if (kind === 'html') return { text: htmlToText(await readTextUpload(file)) };
  if (kind === 'media') throw new Error(`${name} is audio or video, which Semester HQ can’t read. Upload notes, slides, or a transcript instead.`);
  if (kind === 'text' || (kind === 'unknown' && await looksLikeText(file))) {
    const text = await readTextUpload(file);
    return { text: /^\s*<(!doctype html|html)[\s>]/i.test(text) ? htmlToText(text) : text };
  }
  throw new Error(`Semester HQ can’t read ${name}. Save it as a PDF, then upload that.`);
}

// Files that can't be read no matter what's inside, and what to do instead.
function unreadableByName(name, ext) {
  const app = { pages: 'Pages', key: 'Keynote', numbers: 'Numbers' }[ext];
  if (app) return iWorkMessage(name, app);
  if (['gdoc', 'gsheet', 'gslides', 'gdraw'].includes(ext)) return `${name} is only a shortcut to a Google file. Open it in Google Drive, choose File → Download → PDF, then upload that.`;
  if (['mht', 'mhtml', 'webarchive'].includes(ext)) return `${name} is a saved web page, which Semester HQ can’t open. Open the page, print it to a PDF, then upload that.`;
  if (['epub', 'mobi', 'azw', 'azw3'].includes(ext)) return `Semester HQ can’t open e-books like ${name}. Copy the section you need and paste it in instead.`;
  if (['zip', 'rar', '7z'].includes(ext)) return `${name} is a compressed folder. Unzip it, then upload the files inside.`;
  if (/^(mp3|m4a|wav|aac|flac|ogg|oga|opus|mp4|m4v|mov|avi|mkv|webm|wmv)$/.test(ext)) return `${name} is audio or video, which Semester HQ can’t read. Upload notes, slides, or a transcript instead.`;
  return '';
}
function iWorkMessage(name, app) {
  return `${name} is a ${app} file, which Semester HQ can’t open yet. Export it as ${app === 'Numbers' ? 'an Excel file' : 'a PDF'} first (File → Export To on a Mac; on an iPad, tap ••• → Export), then upload that.`;
}

// What a file really is: its first bytes when they tell, then its name,
// then the type the device reported (often blank or generic).
async function uploadKind(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (at, len) => String.fromCharCode(...head.subarray(at, at + len));
  const startsWith = (...bytes) => bytes.every((b, i) => head[i] === b);
  if (ascii(0, 4) === '%PDF') return 'pdf';
  if (startsWith(0xFF, 0xD8, 0xFF) || startsWith(0x89, 0x50, 0x4E, 0x47) || ascii(0, 4) === 'GIF8' || (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP')) return 'image';
  if (ascii(4, 4) === 'ftyp') return /^(hei[cmsx]|hev[cx]|mif1|msf1|avi[fs])$/.test(ascii(8, 4)) ? 'image' : 'media';
  if (startsWith(0x50, 0x4B, 0x03, 0x04)) return 'zip';
  if (startsWith(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1)) return 'ole';
  if (ascii(0, 5) === '{\\rtf') return 'rtf';
  const ext = fileExt(file.name), type = String(file.type || '').toLowerCase();
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
  if (IMAGE_EXTS.includes(ext) || type.startsWith('image/')) return 'image';
  if (ext === 'rtf' || type.includes('rtf')) return 'rtf';
  if (['html', 'htm', 'xhtml'].includes(ext) || type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (TEXT_EXTS.includes(ext) || type.startsWith('text/') || /json|xml|csv/.test(type)) return 'text';
  if (type.startsWith('audio/') || type.startsWith('video/')) return 'media';
  return 'unknown';
}

/* ── Text files ────────────────────────────────────────────────── */
// Whatever encoding it was saved in: UTF-8, UTF-16 (what Windows Notepad
// calls "Unicode"), or older Windows text with accented letters.
async function readTextUpload(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}
// For a file with no telling name or type: text has almost no control bytes.
async function looksLikeText(file) {
  const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if ((bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF)) return true;
  let control = 0;
  for (const b of bytes) if (b < 32 && ![9, 10, 12, 13, 27].includes(b)) control++;
  return bytes.length > 0 && control <= bytes.length * 0.01;
}
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('script, style, noscript, template, svg, iframe, object').forEach(el => el.remove());
  const body = doc.body;
  if (!body) return '';
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('pre, textarea')) node.data = node.data.replace(/\s+/g, ' ');
  }
  body.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
  body.querySelectorAll('td, th').forEach(el => el.append('\t'));
  body.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, header, footer, blockquote, pre, dt, dd, table, ul, ol, hr, figcaption').forEach(el => el.append('\n'));
  const text = body.textContent.replace(/ *\n */g, '\n').replace(/ *\t */g, '\t').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const title = (doc.title || '').trim();
  return title && !text.startsWith(title) ? `${title}\n\n${text}` : text;
}

/* ── RTF (TextEdit, WordPad, and some "Word" downloads) ───────────── */
const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'objdata', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'filetbl', 'revtbl', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'fldinst', 'pntext', 'pntxta', 'pntxtb', 'nonshppict', 'bkmkstart', 'bkmkend', 'txe', 'xe', 'tc', 'userprops', 'docvar', 'falt', 'panose', 'leveltext', 'levelnumbers']);
const RTF_WORDS = { par: '\n', line: '\n', sect: '\n\n', page: '\n\n', row: '\n', cell: '\t', tab: '\t', emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ' };
function rtfToText(rtf) {
  const codePage = (rtf.match(/\\ansicpg(\d+)/) || [])[1];
  const encoding = /\\mac\b/.test(rtf) ? 'macintosh' : { 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 65001: 'utf-8' }[codePage] || `windows-${codePage || 1252}`;
  let decoder;
  try { decoder = new TextDecoder(encoding); } catch { decoder = new TextDecoder('windows-1252'); }
  let out = '', bytes = [], skip = false, uc = 1;
  const groups = [];
  const flush = () => { if (bytes.length) { out += decoder.decode(new Uint8Array(bytes)); bytes = []; } };
  const emit = (s) => { if (!skip) { flush(); out += s; } };
  for (let i = 0; i < rtf.length;) {
    const ch = rtf[i];
    if (ch === '{' || ch === '}') {
      flush();
      if (ch === '{') groups.push([skip, uc]); else [skip, uc] = groups.pop() || [false, 1];
      i++;
    } else if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === "'") { if (!skip) bytes.push(parseInt(rtf.substr(i + 2, 2), 16) || 0); i += 4; continue; }
      if (next === '\\' || next === '{' || next === '}') { emit(next); i += 2; continue; }
      if (next === '*') { skip = true; i += 2; continue; }
      if (next === '~') { emit(' '); i += 2; continue; }
      if (next === '_') { emit('-'); i += 2; continue; }
      if (next === '\n' || next === '\r') { emit('\n'); i += 2; continue; }
      const m = /^([a-z]{1,32})(-?\d{1,10})? ?/i.exec(rtf.slice(i + 1, i + 45));
      if (!m) { i += 2; continue; }
      i += 1 + m[0].length;
      const word = m[1];
      if (word === 'bin') { i += Number(m[2]) || 0; continue; }
      if (RTF_SKIP.has(word)) { skip = true; continue; }
      if (word === 'uc') { uc = Number(m[2]) || 0; continue; }
      if (skip) continue;
      if (word === 'u') {
        let n = Number(m[2]) || 0;
        if (n < 0) n += 65536;
        emit(String.fromCharCode(n));
        // Skip the stand-in characters written for apps that can't do Unicode.
        for (let k = 0; k < uc && i < rtf.length && rtf[i] !== '{' && rtf[i] !== '}'; k++) {
          if (rtf[i] === '\\' && rtf[i + 1] === "'") i += 4;
          else if (rtf[i] === '\\') { const w = /^\\[a-z]{1,32}(-?\d{1,10})? ?/i.exec(rtf.slice(i, i + 45)); i += w ? w[0].length : 2; }
          else i++;
        }
        continue;
      }
      if (RTF_WORDS[word]) emit(RTF_WORDS[word]);
    } else {
      if (ch !== '\r' && ch !== '\n') emit(ch);
      i++;
    }
  }
  flush();
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ── Photos ────────────────────────────────────────────────────── */
// Phone photos are often 4000px+; this shrinks one to a JPEG before it's
// sent anywhere, or gives null when this browser can't open it. It's painted
// on white first, so a transparent PNG (a diagram, a screenshot of notes)
// doesn't come out black.
function downscaleImage(blob, maxSide, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
// A photo as a JPEG data URL. Chrome, Edge, and Firefox can't open iPhone
// (HEIC) photos themselves, so a converter loads the first time one comes
// up there; Safari opens them natively.
async function imageUploadDataUrl(file, maxSide = 1600, quality = 0.82) {
  let dataUrl = await downscaleImage(file, maxSide, quality);
  if (!dataUrl && await isHeicFile(file)) {
    try {
      await loadScriptOnce(HEIC2ANY_SRC);
      const jpeg = await withTimeout(heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 }), 60000, 'Timed out converting that photo');
      dataUrl = await downscaleImage(Array.isArray(jpeg) ? jpeg[0] : jpeg, maxSide, quality);
    } catch (e) { diag.warn('uploads', 'HEIC conversion failed', e); }
  }
  if (!dataUrl) throw new Error(`Couldn’t open ${file.name || 'that photo'}. Save it as a JPG or PNG, then upload that.`);
  return dataUrl;
}
async function isHeicFile(file) {
  if (/^hei[cf]$/.test(fileExt(file.name)) || /hei[cf]/i.test(file.type || '')) return true;
  return /^ftyp(hei[cmsx]|hev[cx]|mif1|msf1)$/.test(String.fromCharCode(...new Uint8Array(await file.slice(4, 12).arrayBuffer())));
}
const dataUrlToImage = (dataUrl) => ({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });

/* ── PDFs ──────────────────────────────────────────────────────── */
// The text when the PDF has it; page images when it's a scan or has almost
// no text, so a scanned or photographed syllabus still reads.
async function pdfUpload(file, { pdfPages, textOnly }) {
  let text = '';
  try { text = (await withTimeout(extractPdfText(file), 30000, 'Timed out reading that PDF')).trim(); }
  catch (e) { if (e?.name === 'PasswordException') throw new Error(passwordMessage(file.name)); }
  if (text.length >= 200 || (textOnly && text)) return { text };
  if (textOnly) throw new Error(`Couldn’t find any text in ${file.name}.`);
  const { images, totalPages } = await pdfPageImagesForUpload(file, pdfPages);
  return { text, images: images.map(dataUrlToImage), pagesLeftOut: totalPages > images.length };
}
async function pdfPageImagesForUpload(file, maxPages) {
  try {
    const result = await withTimeout(extractPdfPageImages(file, { maxPages }), 45000, 'Timed out reading that PDF');
    if (!result.images.length) throw new Error('No pages');
    return result;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new Error(passwordMessage(file.name));
    if (/needed file/.test(e?.message || '')) throw e;
    diag.warn('uploads', 'PDF pages couldn’t be read', e, { bytes: file.size });
    throw new Error(`Couldn’t read ${file.name}. It may be damaged; try opening it and saving a new copy.`);
  }
}
const passwordMessage = (name) => `${name} is password-protected. Save a copy without the password, then upload that.`;

/* ── Word, PowerPoint, Excel, and OpenDocument: zip files of XML ───── */
// Reads the zip's directory, then only the entries asked for, inflated
// with the browser's own DecompressionStream (no library), so a slide deck
// full of videos never has to fit in memory at once.
async function openZip(file) {
  const damaged = () => new Error(`${file.name || 'That file'} looks damaged. Try saving it again, or as a PDF.`);
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
  const tv = new DataView(tail.buffer);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw damaged();
  const count = tv.getUint16(end + 10, true), cdSize = tv.getUint32(end + 12, true), cdStart = tv.getUint32(end + 16, true);
  if (cdStart + cdSize > file.size) throw damaged();
  const cd = new Uint8Array(await file.slice(cdStart, cdStart + cdSize).arrayBuffer());
  const dv = new DataView(cd.buffer);
  const entries = new Map();
  for (let p = 0, n = 0; n < count && p + 46 <= cd.length && dv.getUint32(p, true) === 0x02014b50; n++) {
    const nameLen = dv.getUint16(p + 28, true);
    entries.set(new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen)), { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), offset: dv.getUint32(p + 42, true) });
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  const read = async (name, as) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.method !== 0 && e.method !== 8) throw damaged();
    if (e.method === 8 && typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open that file. Update it, or save the file as a PDF and upload that.');
    try {
      const local = new DataView(await file.slice(e.offset, e.offset + 30).arrayBuffer());
      if (local.byteLength < 30 || local.getUint32(0, true) !== 0x04034b50) throw damaged();
      const start = e.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
      const data = file.slice(start, start + e.size).stream();
      const res = new Response(e.method === 8 ? data.pipeThrough(new DecompressionStream('deflate-raw')) : data);
      return await (as === 'blob' ? res.blob() : res.text());
    } catch { throw damaged(); }
  };
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    text: async (name) => (await read(name, 'text')) || '',
    blob: (name) => read(name, 'blob'),
  };
}
async function zipUpload(file, ext, { pdfPages, textOnly }) {
  const zip = await openZip(file);
  let text, media = '';
  if (zip.has('word/document.xml')) { text = xmlToText(await zip.text('word/document.xml'), { p: 'w:p', cell: 'w:tc', row: 'w:tr' }); media = 'word/media/'; }
  else if (zip.has('ppt/presentation.xml')) { text = await pptxText(zip); media = 'ppt/media/'; }
  else if (zip.has('xl/workbook.xml')) text = sheetsText(await xlsxSheets(zip));
  else if ((await zip.text('mimetype')).startsWith('application/vnd.oasis.opendocument.')) text = await odfText(zip);
  else if (zip.names.some(n => /^Index\/.+\.iwa$/.test(n))) throw new Error(iWorkMessage(file.name, 'Pages, Keynote, or Numbers'));
  else throw new Error(ext && ext !== 'zip' ? `Semester HQ can’t read ${file.name}. Save it as a PDF, then upload that.` : `${file.name} is a compressed folder. Unzip it, then upload the files inside.`);
  // A document that's mostly pictures (a scan pasted into Word, slides of
  // diagrams) sends its pictures too.
  if (media && !textOnly && text.length < 200) {
    const pictures = zip.names.filter(n => n.startsWith(media) && /\.(png|jpe?g|gif|webp)$/i.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const images = [];
    for (const name of pictures.slice(0, pdfPages)) {
      const dataUrl = await downscaleImage(await zip.blob(name), 1600, 0.82);
      if (dataUrl) images.push(dataUrlToImage(dataUrl));
    }
    if (images.length) return { text, images };
  }
  return { text };
}
// Paragraphs become lines. A table row stays on one line with its cells
// tab-separated, so a class schedule kept in a table still reads as
// "week, date, topic" instead of one cell per line. Paragraph, cell, and
// row ends are marked first and settled after the tags are gone, since
// other tags can sit between a cell's last paragraph and the cell's end.
const XML_PARAGRAPH = '\uE000', XML_CELL = '\uE001', XML_ROW = '\uE002';
function xmlToText(xml, { p, cell, row }) {
  let s = String(xml || '')
    .replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '') // a second copy of a text box, for older apps
    .replace(/<w:(delText|instrText)\b[^>]*>[\s\S]*?<\/w:\1>/g, '') // deleted tracked changes, field codes
    .replace(/<office:annotation\b[\s\S]*?<\/office:annotation>/g, '') // comments
    .replace(/>\s*\n\s*</g, '><'); // line breaks between tags are only formatting
  if (cell) s = s.replace(new RegExp(`</${cell}>`, 'g'), XML_CELL).replace(new RegExp(`</${row}>`, 'g'), XML_ROW);
  return decodeEntities(s
    .replace(new RegExp(`</(?:${p})>`, 'g'), XML_PARAGRAPH)
    .replace(/<w:tab\/>|<text:tab(?=[\s/>])[^>]*>/g, '\t')
    .replace(/<(w:br|w:cr|a:br|text:line-break)(?=[\s/>])[^>]*>/g, '\n')
    .replace(/<w:noBreakHyphen\/>/g, '-')
    .replace(/<text:s(?=[\s/>])([^>]*)>/g, (m, attrs) => ' '.repeat(Math.min(100, Number(xmlAttr(attrs, 'text:c')) || 1)))
    .replace(/<[^>]+>/g, ''))
    .replace(new RegExp(`${XML_PARAGRAPH}\\s*(?=${XML_CELL})`, 'g'), '')
    .replace(new RegExp(`${XML_PARAGRAPH}|${XML_ROW}`, 'g'), '\n').replace(new RegExp(XML_CELL, 'g'), '\t')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' }[k];
  });
}
function xmlAttr(tag, name) {
  const m = String(tag || '').match(new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`));
  return m ? (m[1] ?? m[2]) : '';
}
// Where each relationship id in a .rels file points, as a path in the zip.
function relTargets(xml, baseDir) {
  const out = {};
  for (const m of String(xml || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = xmlAttr(m[0], 'Id'), target = decodeEntities(xmlAttr(m[0], 'Target'));
    if (!id || !target || xmlAttr(m[0], 'TargetMode') === 'External') continue;
    const parts = target.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
    for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
    out[id] = parts.join('/');
  }
  return out;
}
// Slides in presentation order (file names keep their old numbers when
// slides are moved), each followed by its speaker notes.
async function pptxText(zip) {
  const presRels = relTargets(await zip.text('ppt/_rels/presentation.xml.rels'), 'ppt');
  let slides = [...(await zip.text('ppt/presentation.xml')).matchAll(/<p:sldId\b[^>]*>/g)].map(m => presRels[xmlAttr(m[0], 'r:id')]).filter(n => n && zip.has(n));
  if (!slides.length) slides = zip.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out = [];
  for (const [i, path] of slides.entries()) {
    const rels = relTargets(await zip.text(path.replace(/([^/]+)$/, '_rels/$1.rels')), path.replace(/\/[^/]+$/, ''));
    const notesPath = Object.values(rels).find(t => /notesSlides\/notesSlide\d+\.xml$/.test(t));
    const body = xmlToText(await zip.text(path), { p: 'a:p', cell: 'a:tc', row: 'a:tr' });
    const notes = notesPath ? xmlToText(await zip.text(notesPath), { p: 'a:p' }).replace(/^\d+$/m, '').trim() : '';
    out.push(`Slide ${i + 1}\n${body}${notes ? `\nNotes: ${notes}` : ''}`);
  }
  return out.join('\n\n');
}
// Each sheet as rows of cell text. Dates stay dates: Excel stores them as
// day counts, so a cell formatted as a date comes out as 2026-09-14, not 46279.
async function xlsxSheets(zip) {
  const [book, rels, shared, styles] = await Promise.all(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml', 'xl/styles.xml'].map(n => zip.text(n)));
  const plain = (xml) => decodeEntities(String(xml || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<[^>]+>/g, ''));
  const strings = [...shared.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map(m => plain(m[1]));
  const formats = {};
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) formats[xmlAttr(m[0], 'numFmtId')] = decodeEntities(xmlAttr(m[0], 'formatCode'));
  const isDate = [...((styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '').matchAll(/<xf\b[^>]*>/g)].map(m => {
    const id = Number(xmlAttr(m[0], 'numFmtId')) || 0;
    return (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)
      || /[dmyhs]/i.test(String(formats[id] || '').replace(/"[^"]*"|\[[^\]]*\]|\\.|[_*]./g, ''));
  });
  const date1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/.test(book);
  const targets = relTargets(rels, 'xl');
  const sheets = [];
  for (const sheet of book.matchAll(/<sheet\b[^>]*>/g)) {
    const path = targets[xmlAttr(sheet[0], 'r:id')];
    if (!path || !zip.has(path)) continue;
    const rows = [];
    for (const r of (await zip.text(path)).matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      for (const [, attrs, inner = ''] of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = xmlAttr(attrs, 'r').replace(/\d+$/, '');
        const col = ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
        if (col < 0 || col > 200) continue;
        const type = xmlAttr(attrs, 't'), v = decodeEntities((inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1] || '');
        let value;
        if (type === 's') value = strings[Number(v)] || '';
        else if (type === 'inlineStr') value = plain((inner.match(/<is\b[^>]*>([\s\S]*)<\/is>/) || [])[1]);
        else if (type === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (type === 'str' || type === 'e' || !v.trim() || !isFinite(Number(v))) value = v;
        else value = isDate[Number(xmlAttr(attrs, 's')) || 0] ? excelDateText(Number(v), date1904) : String(+Number(v).toPrecision(15));
        cells[col] = value.trim();
      }
      const row = Array.from(cells, c => c || '');
      while (row.length && !row[row.length - 1]) row.pop();
      if (row.length) rows.push(row);
      if (rows.length >= 5000) break;
    }
    sheets.push({ name: decodeEntities(xmlAttr(sheet[0], 'name')), rows });
  }
  return sheets;
}
function excelDateText(serial, date1904) {
  const iso = new Date(Date.UTC(1899, 11, 30) + Math.round((serial + (date1904 ? 1462 : 0)) * 86400000)).toISOString();
  if (serial < 1) return iso.slice(11, 16);
  return iso.slice(11, 16) === '00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
function sheetsText(sheets) {
  const filled = sheets.filter(s => s.rows.length);
  return filled.map(s => `${filled.length > 1 ? `Sheet: ${s.name}\n` : ''}${s.rows.map(r => r.join('\t')).join('\n')}`).join('\n\n');
}
// OpenDocument (.odt, .odp, .ods from LibreOffice or Google Docs downloads).
async function odfText(zip) {
  const xml = (await zip.text('content.xml'))
    .replace(/<table:(?:covered-)?table-cell\b([^>]*?)\/>/g, (m, attrs) => '\t'.repeat(Math.min(50, Number(xmlAttr(attrs, 'table:number-columns-repeated')) || 1)))
    .replace(/<\/draw:page>/g, '\n\n');
  return xmlToText(xml, { p: 'text:p|text:h', cell: 'table:table-cell', row: 'table:table-row' });
}
// The first sheet with anything in it, as rows of cell text, when the file
// is a spreadsheet (.xlsx or .ods); null for any other kind of file.
async function spreadsheetRows(file) {
  if (await uploadKind(file) !== 'zip') return null;
  const zip = await openZip(file);
  if (zip.has('xl/workbook.xml')) return (await xlsxSheets(zip)).find(s => s.rows.length)?.rows || [];
  if (!(await zip.text('mimetype')).includes('opendocument.spreadsheet')) return null;
  const rows = [];
  for (const [, rowXml = ''] of (await zip.text('content.xml')).matchAll(/<table:table-row\b[^>]*?(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
    const row = [];
    for (const [, attrs, inner = ''] of rowXml.matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
      const text = xmlToText(inner, { p: 'text:p|text:h' }).replace(/\s*\n\s*/g, ' ');
      row.push(...Array(Math.min(50, Number(xmlAttr(attrs, 'table:number-columns-repeated')) || 1)).fill(text));
    }
    while (row.length && !row[row.length - 1]) row.pop();
    if (row.length) rows.push(row);
  }
  return rows;
}

/* ── Word and PowerPoint 97–2003 (.doc, .ppt) ─────────────────────── */
// Both are a "compound file": a little file system of streams inside one
// file. This finds the top-level streams by name.
async function openCompoundFile(file) {
  const damaged = () => new Error(`${file.name || 'That file'} looks damaged. Try opening it and saving a new copy, or save it as a PDF.`);
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 512) throw damaged();
  const secSize = 1 << dv.getUint16(30, true), miniSize = 1 << dv.getUint16(32, true);
  if (secSize !== 512 && secSize !== 4096) throw damaged();
  const END = 0xFFFFFFFA; // a sector number at or above this ends a chain
  const u32 = (o) => (o + 4 <= buf.length ? dv.getUint32(o, true) : 0xFFFFFFFE);
  const offsetOf = (s) => (s + 1) * secSize;
  const fatSectors = [];
  const fatCount = u32(44);
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) fatSectors.push(u32(76 + i * 4));
  for (let s = u32(68), n = 0; s < END && n < u32(72) && fatSectors.length < fatCount; n++) {
    for (let i = 0; i < secSize / 4 - 1 && fatSectors.length < fatCount; i++) fatSectors.push(u32(offsetOf(s) + i * 4));
    s = u32(offsetOf(s) + secSize - 4);
  }
  const per = secSize / 4;
  const fat = new Uint32Array(fatSectors.length * per);
  fatSectors.forEach((s, k) => { for (let i = 0; i < per; i++) fat[k * per + i] = u32(offsetOf(s) + i * 4); });
  const readChain = (start, table, unit, source, size) => {
    const sectors = [];
    for (let s = start; s < END && s < table.length && sectors.length <= table.length; s = table[s]) sectors.push(s);
    const out = new Uint8Array(sectors.length * unit);
    sectors.forEach((s, i) => { const from = source === buf ? offsetOf(s) : s * unit; out.set(source.subarray(from, from + unit), i * unit); });
    return size == null ? out : out.subarray(0, Math.min(size, out.length));
  };
  const u32s = (bytes) => { const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return Uint32Array.from({ length: bytes.byteLength >> 2 }, (_, i) => v.getUint32(i * 4, true)); };
  const dir = readChain(u32(48), fat, secSize, buf);
  const dirView = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = Math.min(64, dirView.getUint16(o + 64, true));
    entries.push({
      name: new TextDecoder('utf-16le').decode(dir.subarray(o, o + Math.max(0, nameLen - 2))).toLowerCase(),
      type: dir[o + 66], left: dirView.getUint32(o + 68, true), right: dirView.getUint32(o + 72, true), child: dirView.getUint32(o + 76, true),
      start: dirView.getUint32(o + 116, true), size: dirView.getUint32(o + 120, true),
    });
  }
  if (entries[0]?.type !== 5) throw damaged();
  const miniFat = u32s(readChain(u32(60), fat, secSize, buf));
  const miniStream = readChain(entries[0].start, fat, secSize, buf, entries[0].size);
  const cutoff = u32(56) || 4096;
  // Only the top level: an embedded object keeps its own streams (even its
  // own "WordDocument") one level down.
  const top = new Map(), seen = new Set(), stack = [entries[0].child];
  while (stack.length) {
    const id = stack.pop();
    if (id >= entries.length || seen.has(id)) continue;
    seen.add(id);
    const e = entries[id];
    if (e.type === 2) top.set(e.name, e);
    stack.push(e.left, e.right);
  }
  return {
    has: (name) => top.has(name.toLowerCase()),
    stream(name) {
      const e = top.get(name.toLowerCase());
      if (!e) return null;
      return e.size < cutoff ? readChain(e.start, miniFat, miniSize, miniStream, e.size) : readChain(e.start, fat, secSize, buf, e.size);
    },
  };
}
function compoundFileText(cfb, name) {
  if (cfb.has('WordDocument')) return docText(cfb, name);
  if (cfb.has('PowerPoint Document')) return pptText(cfb);
  if (cfb.has('EncryptedPackage')) throw new Error(passwordMessage(name));
  if (cfb.has('Workbook') || cfb.has('Book')) throw new Error(`${name} is an older Excel file (.xls), which Semester HQ can’t open yet. Save it as .xlsx or a PDF, then upload that.`);
  throw new Error(`Semester HQ can’t read ${name}. Save it as a PDF, then upload that.`);
}
// A .doc keeps its text in pieces, listed in a table stream; each piece is
// either one byte per character (Windows text) or two (UTF-16).
function docText(cfb, name) {
  const tooOld = () => new Error(`${name} is an older Word file Semester HQ can’t open. Open it in Word, Pages, or Google Docs, save it as .docx or a PDF, then upload that.`);
  const wd = cfb.stream('WordDocument');
  const v = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  if (wd.length < 160 || v.getUint16(0, true) !== 0xA5EC || v.getUint16(2, true) < 0xC0) throw tooOld();
  const flags = v.getUint16(0x0A, true);
  if (flags & 0x0100) throw new Error(passwordMessage(name));
  let o = 32;
  o += 2 + v.getUint16(o, true) * 2;
  o += 2 + v.getUint16(o, true) * 4 + 2;
  const table = cfb.stream(flags & 0x0200 ? '1Table' : '0Table');
  if (!table || o + 67 * 4 + 4 > wd.length) throw tooOld();
  const fcClx = v.getUint32(o + 66 * 4, true), lcbClx = v.getUint32(o + 67 * 4, true);
  const t = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let p = fcClx;
  while (p < fcClx + lcbClx && p + 3 <= table.length && table[p] === 0x01) p += 3 + t.getUint16(p + 1, true);
  if (p + 5 > table.length || table[p] !== 0x02) throw tooOld();
  const count = Math.floor((t.getUint32(p + 1, true) - 4) / 12);
  const cps = p + 5, pieces = cps + (count + 1) * 4;
  if (count < 1 || pieces + count * 8 > table.length) throw tooOld();
  const latin = new TextDecoder('windows-1252'), wide = new TextDecoder('utf-16le');
  let text = '';
  for (let i = 0; i < count && text.length < 2e6; i++) {
    const len = t.getUint32(cps + (i + 1) * 4, true) - t.getUint32(cps + i * 4, true);
    const fc = t.getUint32(pieces + i * 8 + 2, true);
    if (len <= 0) continue;
    if (fc & 0x40000000) { const at = (fc & 0x3FFFFFFF) >>> 1; text += latin.decode(wd.subarray(at, at + len)); }
    else text += wide.decode(wd.subarray(fc, fc + len * 2));
  }
  // Word's own marks in the text: fields ({HYPERLINK "…"}shown text), cell and
  // row ends, page breaks, and anchors for pictures.
  let out = '';
  const fields = []; // per open field: still in its hidden instructions?
  for (const ch of text.replace(/\x07\x07/g, '\x07\n')) {
    const c = ch.charCodeAt(0);
    if (c === 0x13) fields.push(true);
    else if (c === 0x14) { if (fields.length) fields[fields.length - 1] = false; }
    else if (c === 0x15) fields.pop();
    else if (fields.includes(true)) continue;
    else if (c === 0x0D || c === 0x0B || c === 0x0C || c === 0x0A) out += '\n';
    else if (c === 0x07 || c === 0x09) out += '\t';
    else if (c === 0x1E) out += '-';
    else if (c === 0xA0) out += ' ';
    else if (c >= 0x20) out += ch;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// A .ppt is a tree of records; slide and note text sits in text records.
// Master slides are skipped so their "Click to edit" placeholders don't.
function pptText(cfb) {
  const s = cfb.stream('PowerPoint Document');
  const v = new DataView(s.buffer, s.byteOffset, s.byteLength);
  const latin = new TextDecoder('windows-1252'), wide = new TextDecoder('utf-16le');
  const found = [];
  const walk = (start, end, depth) => {
    for (let p = start; p + 8 <= end;) {
      const type = v.getUint16(p + 2, true), next = p + 8 + v.getUint32(p + 4, true);
      if (next > end) break;
      if ((v.getUint16(p, true) & 0x0F) === 0x0F) { if (depth < 12 && type !== 0x03F8 && type !== 0x0FC9) walk(p + 8, next, depth + 1); }
      else if (type === 0x0FA0) found.push(wide.decode(s.subarray(p + 8, next)));
      else if (type === 0x0FA8) found.push(latin.decode(s.subarray(p + 8, next)));
      p = next;
    }
  };
  walk(0, s.length, 0);
  const lines = [];
  for (const line of found.join('\n').split(/[\r\n\x0B]/)) {
    const clean = line.trim();
    if (clean && !/^(Click to edit (the )?Master (title|subtitle|text) styles?|Second level|Third level|Fourth level|Fifth level|\*|‹#›)$/i.test(clean) && lines[lines.length - 1] !== clean) lines.push(clean);
  }
  return lines.join('\n');
}

/* ── Upload zones: a drop area and file picker inside a modal ─────── */
// Whatever's chosen is read right away and waits in _uploadZones[key]
// until the modal's main button asks for it with uploadZoneMaterial.
const _uploadZones = {};
function uploadZoneHtml(key, prompt, hint) {
  return `<div class="upload-drop" onclick="if(event.target.tagName!=='INPUT')$('#uz-${key}-input').click()" ondragover="event.preventDefault();this.classList.add('drag')" ondragleave="this.classList.remove('drag')" ondrop="event.preventDefault();this.classList.remove('drag');loadUploadZone('${key}',event.dataTransfer.files)">
    <div class="small sg-strong" id="uz-${key}-status">${prompt}</div>
    <div class="small muted">${hint}</div>
    <input type="file" id="uz-${key}-input" multiple hidden onchange="loadUploadZone('${key}',this.files)">
  </div>`;
}
async function loadUploadZone(key, fileList) {
  const files = Array.from(fileList || []);
  const input = $(`#uz-${key}-input`);
  if (input) input.value = '';
  if (!files.length) return;
  const token = uid(), name = files.length > 1 ? `${files.length} files` : files[0].name;
  const status = (html) => { const el = $(`#uz-${key}-status`); if (el) el.innerHTML = html; };
  _uploadZones[key] = { token, ready: false };
  status(`${icon('refresh-cw', 12, 2.2)} Reading ${esc(name)}…`);
  try {
    const result = await readUploadedFiles(files);
    if (_uploadZones[key]?.token !== token) return; // closed, or other files were picked meanwhile
    _uploadZones[key] = { token, ready: true, fileNames: files.map(f => f.name), ...result };
    status(`${icon('check', 12, 2.2)} ${esc(name)} · ${uploadReadySummary(result)}`);
    toastUploadProblems(result);
  } catch (e) {
    if (_uploadZones[key]?.token !== token) return;
    delete _uploadZones[key];
    status(esc(e.message || 'Couldn’t read that file.'));
  }
}
// What a modal's main button sends, or null after saying why there's nothing.
function uploadZoneMaterial(key, emptyMessage) {
  const zone = _uploadZones[key];
  if (!zone) { toast(emptyMessage, 'error'); return null; }
  if (!zone.ready) { toast('Still reading that file, one moment', 'info'); return null; }
  return { text: zone.text, images: zone.images, fileNames: zone.fileNames || [] };
}
