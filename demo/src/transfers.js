import { uid } from './model.js';
import { getCardColor } from './board-palette.js';

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2000;
const MAX_NOTES = 10000;
const MAX_CELL_LENGTH = 32767;
const encoder = new TextEncoder();
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');

function filename(value = 'Socrates') {
  return String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 100) || 'Socrates';
}

function startDownload(blob, name, count) {
  // Returning the real Blob also makes format round-trip verification possible without a DOM.
  if (typeof document !== 'undefined') {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = 'none';
    document.body.append(anchor);
    try { anchor.click(); } finally {
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }
  return { filename: name, blob, count, size: blob.size };
}

function utf8(bytes, label = 'file') {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { fail(`The ${label} is not valid UTF-8. Save it as UTF-8 and import it again.`); }
}

function parseJSON(text, label) {
  try { return JSON.parse(text); }
  catch { fail(`The ${label} contains invalid JSON. Check its format and try again.`); }
}

function shortSummary(body, fallback = 'Imported note') {
  const first = String(body).split(/\r?\n/).find(line => line.trim()) || fallback;
  const text = first.replace(/^\s{0,3}#{1,6}\s+/, '').trim() || fallback;
  const chars = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment)
    : Array.from(text);
  return chars.slice(0, 160).join('');
}

function importedNote(value, label = 'note') {
  if (!isObject(value)) fail(`The ${label} must be a note object.`);
  const body = value.body ?? value.body_md ?? '';
  if (typeof body !== 'string') fail(`The ${label} has a body that is not text.`);
  const summary = value.summary ?? shortSummary(body);
  if (typeof summary !== 'string' || !summary.trim()) fail(`The ${label} needs a one-line summary.`);
  const tags = value.tags ?? [];
  if (!strings(tags)) fail(`The ${label} needs a list of text tags.`);
  const now = new Date().toISOString();
  const date = (value, name) => {
    if (value === undefined || value === null || value === '') return now;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(`The ${label} has an invalid ${name} date.`);
    return value;
  };
  return {
    id: uid('note'), summary, body, tags: [...new Set(tags.filter(tag => tag.trim()))],
    createdAt: date(value.createdAt ?? value.created_at, 'created'),
    updatedAt: date(value.updatedAt ?? value.updated_at ?? value.createdAt ?? value.created_at, 'updated'),
    deleted: false,
  };
}

function noteResult(notes, warnings = []) {
  if (!notes.length) fail('No notes were found in this file.');
  if (notes.length > MAX_NOTES) fail(`Import at most ${MAX_NOTES.toLocaleString('en-US')} notes at a time.`);
  return { kind: 'notes', notes, ...(warnings.length ? { warnings } : {}) };
}

function exportNotes(notes) {
  if (!Array.isArray(notes) || !notes.length) fail('Select at least one note to export.');
  const seen = new Set();
  return notes.filter(note => {
    if (!isObject(note) || typeof note.id !== 'string' || typeof note.summary !== 'string' || typeof note.body !== 'string' || !strings(note.tags)) {
      fail('A selected note is incomplete. Refresh the note and try exporting again.');
    }
    if (seen.has(note.id)) return false;
    seen.add(note.id);
    return true;
  });
}

function markdownDocument(notes) {
  return notes.map(note => [
    '---', 'schema_version: 1', `id: ${JSON.stringify(note.id)}`,
    `summary: ${JSON.stringify(note.summary)}`, `tags: ${JSON.stringify(note.tags)}`,
    `created_at: ${JSON.stringify(note.createdAt || new Date().toISOString())}`,
    `updated_at: ${JSON.stringify(note.updatedAt || note.createdAt || new Date().toISOString())}`,
    // A UTF-16 length makes combined exports unambiguous, even if a body contains another valid frontmatter block.
    `body_length: ${note.body.length}`, '---', '', note.body,
  ].join('\n')).join('\n\n');
}

function readFrontmatter(text, offset) {
  const opening = /^---\r?\n/.exec(text.slice(offset));
  if (!opening) return null;
  const start = offset + opening[0].length;
  const closing = /\r?\n---(?:\r?\n|$)/.exec(text.slice(start));
  if (!closing) return null;
  const fields = {};
  for (const line of text.slice(start, start + closing.index).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!item) return null;
    try { fields[item[1]] = JSON.parse(item[2]); } catch { return null; }
  }
  if (typeof fields.summary !== 'string' || !strings(fields.tags ?? [])) return null;
  let bodyStart = start + closing.index + closing[0].length;
  if (text.startsWith('\r\n', bodyStart)) bodyStart += 2;
  else if (text[bodyStart] === '\n') bodyStart += 1;
  return { fields, bodyStart };
}

function parseMarkdown(text, name) {
  const initial = readFrontmatter(text, 0);
  if (!initial) return [importedNote({ summary: shortSummary(text, name.replace(/\.[^.]+$/, '')), body: text })];
  const notes = [];
  let offset = 0;
  while (offset < text.length) {
    const header = readFrontmatter(text, offset);
    if (!header) fail('A Markdown note has an invalid frontmatter boundary. Import the original file again.');
    const { fields, bodyStart } = header;
    if (fields.schema_version !== undefined && fields.schema_version !== 1) fail('This Markdown schema is not supported. Export it using schema version 1.');
    let bodyEnd;
    let nextOffset;
    if (fields.body_length !== undefined) {
      if (!Number.isSafeInteger(fields.body_length) || fields.body_length < 0 || bodyStart + fields.body_length > text.length) {
        fail('The Markdown body length does not match its contents. The file may be incomplete.');
      }
      bodyEnd = bodyStart + fields.body_length;
      nextOffset = bodyEnd;
      while (/\s/.test(text[nextOffset] || '') && nextOffset < text.length) nextOffset += 1;
    } else {
      // Compatibility with model.markdownForNotes and earlier JSON-valued YAML exports.
      const starts = /^---\r?\n/gm;
      starts.lastIndex = bodyStart;
      let candidate;
      while ((candidate = starts.exec(text)) && !readFrontmatter(text, candidate.index)) { /* continue */ }
      nextOffset = candidate?.index ?? text.length;
      bodyEnd = nextOffset;
      const tail = text.slice(bodyStart, bodyEnd);
      const separator = candidate ? /\r?\n\r?\n$/.exec(tail) : /\r?\n$/.exec(tail);
      if (separator) bodyEnd -= separator[0].length;
    }
    notes.push(importedNote({ ...fields, body: text.slice(bodyStart, bodyEnd) }, `Markdown note ${notes.length + 1}`));
    if (notes.length > MAX_NOTES) fail(`This file contains more than ${MAX_NOTES} notes.`);
    offset = nextOffset;
  }
  return notes;
}

async function makeDocx(notes, map) {
  const [{ Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType }, { marked }] = await Promise.all([
    import('docx'), import('marked'),
  ]);
  const runs = (tokens, style = {}) => (tokens || []).flatMap(token => {
    if (token.type === 'strong') return runs(token.tokens, { ...style, bold: true });
    if (token.type === 'em') return runs(token.tokens, { ...style, italics: true });
    if (token.type === 'del') return runs(token.tokens, { ...style, strike: true });
    if (token.type === 'link') return [...runs(token.tokens, style), new TextRun({ text: ` (${token.href})`, ...style })];
    if (token.type === 'image') return [new TextRun({ text: `${token.text || 'Image'} (${token.href})`, ...style })];
    if (token.type === 'br') return [new TextRun({ text: '', break: 1 })];
    if (token.tokens) return runs(token.tokens, style);
    const text = token.text ?? token.raw ?? '';
    return String(text).split('\n').map((line, index) => new TextRun({
      text: line, ...style, ...(token.type === 'codespan' ? { font: 'Consolas' } : {}), ...(index ? { break: 1 } : {}),
    }));
  });
  const inline = text => runs(marked.Lexer.lexInline(text));
  const paragraphs = (tokens, depth = 0) => tokens.flatMap(token => {
    if (token.type === 'space') return [];
    if (token.type === 'heading') return [new Paragraph({ heading: HeadingLevel[`HEADING_${Math.min(token.depth, 6)}`], children: runs(token.tokens) })];
    if (token.type === 'table') {
      const cells = (row, bold = false) => row.map(cell => new TableCell({ children: [new Paragraph({ children: runs(cell.tokens, { bold }) })] }));
      return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
        new TableRow({ tableHeader: true, children: cells(token.header, true) }),
        ...token.rows.map(row => new TableRow({ children: cells(row) })),
      ] })];
    }
    if (token.type === 'list') return token.items.flatMap((item, index) => {
      const marker = token.ordered ? `${Number(token.start || 1) + index}. ` : '• ';
      const itemTokens = item.tokens || [];
      const first = itemTokens[0];
      const text = first?.tokens ? runs(first.tokens) : inline(first?.text || item.text);
      return [new Paragraph({ indent: { left: 360 * (depth + 1), hanging: 180 }, children: [new TextRun(marker), ...text] }),
        ...paragraphs(itemTokens.slice(1), depth + 1)];
    });
    if (token.type === 'blockquote') return paragraphs(token.tokens, depth + 1);
    if (token.type === 'code') return token.text.split('\n').map(line => new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 20 })] }));
    if (token.type === 'hr') return [new Paragraph({ text: '────────────────────' })];
    return [new Paragraph({ spacing: { after: 140 }, children: token.tokens ? runs(token.tokens) : inline(token.text || token.raw || '') })];
  });
  const children = [];
  if (map) {
    children.push(new Paragraph({ text: map.name || 'Knowledge Map', heading: HeadingLevel.TITLE }));
    if (map.summary) children.push(new Paragraph({ text: map.summary }));
    if (map.description) children.push(...paragraphs(marked.lexer(map.description)));
  }
  notes.forEach(note => {
    children.push(new Paragraph({ text: note.summary, heading: HeadingLevel.HEADING_1 }));
    if (note.tags.length) children.push(new Paragraph({ children: [new TextRun({ text: note.tags.map(tag => `#${tag}`).join('  '), color: '707070' })] }));
    children.push(...paragraphs(marked.lexer(note.body)));
  });
  const doc = new Document({
    creator: 'Socrates', title: map?.name || 'Socrates Notes',
    styles: { default: { document: { run: { font: { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' }, size: 22 }, paragraph: { spacing: { line: 300 } } } } },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}

function cellText(value, label = 'cell') {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (isObject(value) && ('formula' in value || 'sharedFormula' in value)) fail(`The ${label} contains a formula. Convert formulas to text values before importing.`);
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  if (typeof value.text === 'string') return value.text;
  fail(`The ${label} contains an unsupported cell value. Convert it to text before importing.`);
}

function addSheet(workbook, name, headers, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  rows.forEach((row, i) => sheet.addRow(row.map(value => {
    const text = value === undefined || value === null ? '' : String(value);
    if (text.length > MAX_CELL_LENGTH) fail(`${name} row ${i + 2} contains a field too long for Excel. Use a full backup to preserve it.`);
    // Assign strings, never formula objects, including input that starts with '='.
    return text;
  })));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.columns.forEach(column => { column.width = 28; column.alignment = { vertical: 'top', wrapText: true }; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return sheet;
}

async function makeXlsx(notes, map) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Socrates';
  workbook.created = new Date();
  const chunks = [];
  addSheet(workbook, 'Notes', ['id', 'summary', 'body', 'tags_json', 'created_at', 'updated_at', 'body_storage'], notes.map(note => {
    const chunked = note.body.length > MAX_CELL_LENGTH;
    if (chunked) {
      let offset = 0;
      let index = 0;
      while (offset < note.body.length) {
        let end = Math.min(offset + 32000, note.body.length);
        const last = note.body.charCodeAt(end - 1);
        if (end < note.body.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
        chunks.push([note.id, String(index++), note.body.slice(offset, end)]);
        offset = end;
      }
    }
    return [note.id, note.summary, chunked ? '' : note.body, JSON.stringify(note.tags), note.createdAt, note.updatedAt, chunked ? 'chunks' : 'inline'];
  }));
  if (chunks.length) addSheet(workbook, 'NoteBodyChunks', ['note_id', 'chunk_index', 'text'], chunks);
  const tags = [...new Set(notes.flatMap(note => note.tags))];
  addSheet(workbook, 'Tags', ['name'], tags.map(tag => [tag]));
  addSheet(workbook, 'NoteTags', ['note_id', 'tag_name', 'position'], notes.flatMap(note => note.tags.map((tag, index) => [note.id, tag, index])));
  if (map) {
    const mapId = map.id || 'exported-map';
    addSheet(workbook, 'Maps', ['id', 'name', 'summary', 'description'], [[mapId, map.name, map.summary, map.description]]);
    addSheet(workbook, 'Nodes', ['id', 'map_id', 'note_id', 'kind', 'parent_id', 'x', 'y', 'color', 'properties_json'], (map.nodes || []).map(node => [node.id, mapId, node.noteId, node.type, node.parentId, node.position?.x, node.position?.y, node.noteId ? getCardColor(node.color).id : '', JSON.stringify(node)]));
    addSheet(workbook, 'Edges', ['id', 'map_id', 'source_node_id', 'target_node_id', 'label', 'properties_json'], (map.edges || []).map(edge => [edge.id, mapId, edge.source, edge.target, edge.label, JSON.stringify(edge)]));
    addSheet(workbook, 'MapTags', ['map_id', 'tag_name', 'position'], (map.tagOrder || tags).map((tag, index) => [mapId, tag, index]));
    addSheet(workbook, 'NoteOrder', ['map_id', 'note_id', 'position'], notes.map((note, index) => [mapId, note.id, index]));
  }
  return new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Generate and download genuine Markdown, Word, or Excel files from a frozen note selection. */
export async function downloadNotes(notes, format, map = null) {
  const selected = exportNotes(notes).map(note => ({ ...note, tags: [...note.tags] }));
  const snapshotMap = map ? JSON.parse(JSON.stringify(map)) : null;
  const base = filename(map?.name || (selected.length === 1 ? selected[0].summary : 'Socrates Notes'));
  if (format === 'markdown') return startDownload(new Blob([markdownDocument(selected)], { type: 'text/markdown;charset=utf-8' }), `${base}.md`, selected.length);
  if (format === 'docx') return startDownload(await makeDocx(selected, snapshotMap), `${base}.docx`, selected.length);
  if (format === 'xlsx') return startDownload(await makeXlsx(selected, snapshotMap), `${base}.xlsx`, selected.length);
  fail('Choose Markdown, Word (.docx), or Excel (.xlsx) as the export format.');
}

function validateBackup(value) {
  if (!isObject(value) || value.version !== 1) fail('This backup uses an unsupported schema. A Socrates version 1 backup is required.');
  if (!Array.isArray(value.notes) || !strings(value.tags) || !Array.isArray(value.maps)) fail('The backup must contain notes, tags, and maps arrays.');
  if (value.notes.length > MAX_NOTES || value.maps.length > 1000) fail('This backup exceeds the prototype limit of 10,000 notes or 1,000 maps.');
  if (!['light', 'dark', 'system'].includes(value.theme) || typeof value.motion !== 'boolean') fail('The backup contains invalid appearance preferences.');
  const cleanKeys = (item, depth = 0) => {
    if (depth > 40) fail('This backup has an unsupported nesting depth.');
    if (!item || typeof item !== 'object') return;
    for (const key of Object.keys(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('This backup contains an unsafe object field.');
      cleanKeys(item[key], depth + 1);
    }
  };
  cleanKeys(value);
  const uniqueIds = (items, label) => {
    const ids = new Set();
    items.forEach(item => {
      if (!isObject(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail(`The backup contains a missing or duplicate ${label} ID.`);
      ids.add(item.id);
    });
    return ids;
  };
  const checkNote = note => {
    if (typeof note.summary !== 'string' || typeof note.body !== 'string' || !strings(note.tags) || typeof note.createdAt !== 'string' || typeof note.updatedAt !== 'string') fail('The backup contains an incomplete note.');
    if (!Number.isFinite(Date.parse(note.createdAt)) || !Number.isFinite(Date.parse(note.updatedAt))) fail('The backup contains an invalid note date.');
  };
  const noteIds = uniqueIds(value.notes, 'note');
  value.notes.forEach(checkNote);
  uniqueIds(value.maps, 'map');
  const structure = (map, allowedNotes, label) => {
    if (!Array.isArray(map.nodes) || !Array.isArray(map.edges) || typeof map.name !== 'string' || typeof map.summary !== 'string' || typeof map.description !== 'string') fail(`The ${label} has incomplete map fields.`);
    if (map.nodes.length > 10000 || map.edges.length > 20000) fail(`The ${label} has too many canvas elements for this prototype.`);
    const nodeIds = uniqueIds(map.nodes, 'node');
    uniqueIds(map.edges, 'connection');
    map.nodes.forEach(node => {
      if (!isObject(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || typeof node.type !== 'string') fail(`The ${label} has an invalid node position or type.`);
      if (node.noteId && !allowedNotes.has(node.noteId)) fail(`The ${label} refers to a missing note.`);
      if (node.color !== undefined && typeof node.color !== 'string') fail(`The ${label} has an invalid card color.`);
      if (node.zIndex !== undefined && !Number.isFinite(node.zIndex)) fail(`The ${label} has an invalid layer order.`);
      if (node.type === 'shape') {
        if (!isObject(node.data) || !['rectangle', 'ellipse'].includes(node.data.shape) || typeof node.data.label !== 'string') fail(`The ${label} has an invalid region shape.`);
        if (node.data.strokeStyle !== undefined && !['solid', 'dashed'].includes(node.data.strokeStyle)) fail(`The ${label} has an invalid region outline.`);
        if (node.data.color !== undefined && typeof node.data.color !== 'string') fail(`The ${label} has an invalid region color.`);
        if (!isObject(node.style) || !Number.isFinite(node.style.width) || !Number.isFinite(node.style.height) || node.style.width <= 0 || node.style.height <= 0) fail(`The ${label} has invalid region dimensions.`);
      }
      if (node.parentId && (!nodeIds.has(node.parentId) || node.parentId === node.id)) fail(`The ${label} has an invalid group reference.`);
    });
    map.edges.forEach(edge => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) fail(`The ${label} has a connection with a missing endpoint.`);
      if (edge.label !== undefined && typeof edge.label !== 'string') fail(`The ${label} has an invalid connection label.`);
      if (edge.zIndex !== undefined && !Number.isFinite(edge.zIndex)) fail(`The ${label} has an invalid layer order.`);
      if (edge.route !== undefined && (!Array.isArray(edge.route) || edge.route.length > 64 || edge.route.some(anchor => !isObject(anchor) || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)))) fail(`The ${label} has an invalid connection route.`);
    });
    if (map.tagOrder !== undefined && !strings(map.tagOrder)) fail(`The ${label} has an invalid tag order.`);
  };
  value.maps.forEach(map => {
    structure(map, noteIds, `map “${map.name || map.id}”`);
    if (map.history !== undefined && !Array.isArray(map.history)) fail('A map has an invalid version history.');
    [...(map.history || []), ...(map.saved ? [map.saved] : [])].forEach(revision => {
      if (!isObject(revision) || !Array.isArray(revision.notes) || !Number.isInteger(revision.number) || revision.number < 1) fail('The backup contains an invalid saved version.');
      const revisionNotes = uniqueIds(revision.notes, 'saved note');
      revision.notes.forEach(checkNote);
      structure(revision, revisionNotes, 'saved version');
    });
  });
  return value;
}

async function checksum(bytes, algorithm = globalThis.crypto?.subtle ? 'sha256' : 'crc32') {
  if (algorithm === 'sha256') {
    if (!globalThis.crypto?.subtle) fail('Checking this backup requires a secure browser context. Open Socrates on localhost or HTTPS.');
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    return { algorithm, value: [...hash].map(value => value.toString(16).padStart(2, '0')).join('') };
  }
  if (algorithm !== 'crc32') fail('The backup uses an unsupported checksum algorithm.');
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return { algorithm, value: ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0') };
}

/** Full local state, including saved versions and deleted items, is preserved in a real ZIP. */
export async function downloadBackup(data) {
  const snapshot = validateBackup(JSON.parse(JSON.stringify(data)));
  const json = JSON.stringify(snapshot, null, 2);
  const bytes = encoder.encode(json);
  if (bytes.length > MAX_EXPANDED_BYTES) fail('This backup is too large for the browser prototype. Export smaller note selections.');
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('socrates.json', json);
  zip.file('manifest.json', JSON.stringify({
    format: 'socrates-backup', schema_version: 1, created_at: new Date().toISOString(),
    file: 'socrates.json', size: bytes.length, checksum: await checksum(bytes),
    counts: { notes: snapshot.notes.length, tags: snapshot.tags.length, maps: snapshot.maps.length },
  }, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (blob.size > MAX_FILE_BYTES) fail('This backup exceeds the 30 MB import limit. Export smaller note selections instead.');
  return startDownload(blob, `Socrates-${new Date().toISOString().slice(0, 10)}.socrates.zip`, snapshot.notes.length);
}

function inspectArchive(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 65557); pos -= 1) {
    if (view.getUint32(pos, true) === 0x06054b50 && pos + 22 + view.getUint16(pos + 20, true) === bytes.length) { end = pos; break; }
  }
  if (end < 0) fail('This is not a complete ZIP, Word, or Excel file.');
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail('Split ZIP archives are not supported.');
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  let cursor = view.getUint32(end + 16, true);
  if (count === 0xffff || cursor === 0xffffffff || centralSize === 0xffffffff) fail('ZIP64 archives are not supported by this prototype.');
  if (count > MAX_ARCHIVE_ENTRIES) fail(`The archive contains more than ${MAX_ARCHIVE_ENTRIES} entries.`);
  if (view.getUint16(end + 8, true) !== count || cursor + centralSize > end) fail('The archive directory is invalid.');
  let expanded = 0;
  const names = new Set();
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) fail('The archive has a damaged entry.');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end) fail('The archive contains a truncated entry.');
    if (flags & 1) fail('Password-protected files are not supported. Export an unencrypted copy.');
    if (![0, 8].includes(method)) fail('The archive uses an unsupported compression method.');
    const path = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)).replace(/\\/g, '/');
    if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('\0') || path.split('/').includes('..')) fail('The archive contains an unsafe file path.');
    if (names.has(path)) fail('The archive contains duplicate file paths.');
    names.add(path);
    expanded += size;
    if (size === 0xffffffff || expanded > MAX_EXPANDED_BYTES) fail('The expanded archive exceeds the 64 MB import limit.');
    cursor = next;
  }
}

async function openArchive(buffer) {
  inspectArchive(buffer);
  const { default: JSZip } = await import('jszip');
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch { fail('The archive could not be opened. It may be damaged or unsupported.'); }
  let total = 0;
  const cached = new Map();
  const read = async name => {
    if (cached.has(name)) return cached.get(name);
    const entry = zip.file(name);
    if (!entry) fail(`The archive is missing ${name}.`);
    const bytes = await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let stopped = false;
      const stream = entry.internalStream('uint8array');
      stream.on('data', chunk => {
        if (stopped) return;
        total += chunk.length;
        size += chunk.length;
        if (total > MAX_EXPANDED_BYTES) {
          stopped = true;
          stream.pause();
          reject(new Error('The expanded archive exceeds the 64 MB import limit.'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', () => { if (!stopped) reject(new Error(`The archive entry ${name} is damaged.`)); });
      stream.on('end', () => {
        if (stopped) return;
        const result = new Uint8Array(size);
        let offset = 0;
        chunks.forEach(chunk => { result.set(chunk, offset); offset += chunk.length; });
        cached.set(name, result);
        resolve(result);
      });
      stream.resume();
    });
    return bytes;
  };
  return { zip, read, names: Object.keys(zip.files).filter(name => !zip.files[name].dir) };
}

async function parseZip(buffer) {
  const archive = await openArchive(buffer);
  if (archive.names.includes('socrates.json')) {
    if (!archive.names.includes('manifest.json')) fail('This backup is missing manifest.json. Export a complete Socrates backup.');
    const manifest = parseJSON(utf8(await archive.read('manifest.json'), 'manifest'), 'manifest');
    if (manifest.format !== 'socrates-backup' || manifest.schema_version !== 1 || manifest.file !== 'socrates.json' || !isObject(manifest.checksum)) fail('This backup manifest is not supported.');
    const bytes = await archive.read('socrates.json');
    const actual = await checksum(bytes, manifest.checksum.algorithm);
    if (manifest.size !== bytes.length || actual.value !== manifest.checksum.value) fail('The backup checksum does not match. The file is incomplete or has been changed.');
    return { kind: 'backup', data: validateBackup(parseJSON(utf8(bytes, 'backup'), 'backup')) };
  }
  const files = archive.names.filter(name => !name.startsWith('__MACOSX/') && !name.endsWith('.DS_Store'));
  if (!files.length || files.some(name => !/\.md$/i.test(name))) fail('Import a Socrates backup or a ZIP containing only Markdown (.md) files.');
  const notes = [];
  for (const name of files.sort()) {
    notes.push(...parseMarkdown(utf8(await archive.read(name), name), name));
    if (notes.length > MAX_NOTES) fail(`This archive contains more than ${MAX_NOTES} notes.`);
  }
  return noteResult(notes);
}

function worksheetRows(sheet) {
  if (!sheet || sheet.rowCount > MAX_NOTES * 100) fail('The workbook has too many rows for this prototype.');
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, index) => headers.set(cellText(cell.value, 'header').trim().toLowerCase().replace(/[ -]/g, '_'), index));
  const rows = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const data = {};
    headers.forEach((index, key) => { data[key] = cellText(row.getCell(index).value, `${sheet.name} row ${number}, ${key}`); });
    if (Object.values(data).some(value => value !== '')) rows.push({ data, number });
  });
  return rows;
}

async function parseXlsx(buffer) {
  const archive = await openArchive(buffer);
  if (!archive.names.includes('xl/workbook.xml')) fail('This is not an Excel .xlsx workbook.');
  // Check actual decompressed sizes before the workbook library inflates its own copy.
  for (const name of archive.names) await archive.read(name);
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); } catch { fail('The Excel workbook could not be read. Save it as a standard .xlsx file.'); }
  const sheet = workbook.getWorksheet('Notes') || workbook.worksheets[0];
  if (!sheet) fail('The Excel workbook has no worksheets.');
  const chunks = new Map();
  const chunkSheet = workbook.getWorksheet('NoteBodyChunks');
  if (chunkSheet) worksheetRows(chunkSheet).forEach(({ data, number }) => {
    const index = Number(data.chunk_index);
    if (!data.note_id || data.chunk_index === '' || !Number.isInteger(index) || index < 0) fail(`NoteBodyChunks row ${number} has an invalid note ID or chunk index.`);
    const parts = chunks.get(data.note_id) || new Map();
    if (parts.has(index)) fail(`NoteBodyChunks contains duplicate chunk ${index} for a note.`);
    parts.set(index, data.text ?? '');
    chunks.set(data.note_id, parts);
  });
  const rows = worksheetRows(sheet);
  if (rows.length > MAX_NOTES) fail(`Import at most ${MAX_NOTES} notes at a time.`);
  const notes = rows.map(({ data, number }) => {
    let body = data.body ?? data.details ?? data.text ?? data.body_md ?? '';
    if (data.body_storage === 'chunks') {
      const parts = chunks.get(data.id);
      if (!parts?.size) fail(`Notes row ${number} is missing its body chunks.`);
      const ordered = [...parts].sort((a, b) => a[0] - b[0]);
      if (ordered.some(([index], position) => index !== position)) fail(`Notes row ${number} has incomplete body chunks.`);
      body = ordered.map(([, text]) => text).join('');
    } else if (data.body_storage && data.body_storage !== 'inline') fail(`Notes row ${number} has an unsupported body storage format.`);
    let tags = [];
    if (data.tags_json) tags = parseJSON(data.tags_json, `tags_json in row ${number}`);
    else if (data.tags) tags = data.tags.split(/[,;\n]/).map(tag => tag.trim().replace(/^#/, '')).filter(Boolean);
    const summary = data.summary || data.one_line_summary || data.title || shortSummary(body);
    if (!['summary', 'one_line_summary', 'title', 'body', 'details', 'text', 'body_md'].some(key => key in data)) fail('The worksheet needs a summary/title column or a body/details/text column.');
    return importedNote({ summary, body, tags, created_at: data.created_at, updated_at: data.updated_at }, `Excel row ${number}`);
  });
  const warnings = workbook.getWorksheet('Maps') ? ['Notes were imported as new copies. Map structure in this workbook is reference data; restore a .socrates.zip backup to restore maps and versions.'] : [];
  return noteResult(notes, warnings);
}

async function parseDocx(buffer, name) {
  if (typeof DOMParser === 'undefined') fail('Word import requires a browser with XML parsing support.');
  const archive = await openArchive(buffer);
  if (!archive.names.includes('word/document.xml')) fail('This is not a Word .docx document.');
  const xml = utf8(await archive.read('word/document.xml'), 'Word document');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('This Word document contains unsupported XML entities.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) fail('The Word document contains invalid XML.');
  const bodyElement = doc.getElementsByTagNameNS('*', 'body')[0];
  if (!bodyElement) fail('The Word document has no readable body.');
  const textOf = node => {
    if (node.nodeType !== 1) return '';
    if (node.localName === 't') return node.textContent || '';
    if (node.localName === 'tab') return '\t';
    if (['br', 'cr'].includes(node.localName)) return '\n';
    if (['del', 'instrText', 'drawing', 'pict'].includes(node.localName)) return '';
    return [...node.childNodes].map(textOf).join('');
  };
  const paragraph = element => {
    const value = textOf(element);
    const style = element.getElementsByTagNameNS('*', 'pStyle')[0];
    const styleName = style?.getAttribute('w:val') || style?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val') || '';
    const heading = /heading\s*([1-6])/i.exec(styleName);
    return heading ? `${'#'.repeat(Number(heading[1]))} ${value}` : value;
  };
  const blocks = [];
  const walkBlocks = element => {
    for (const child of [...element.children]) {
      if (child.localName === 'p') blocks.push(paragraph(child));
      else if (child.localName === 'tbl') {
        const rows = [...child.children].filter(row => row.localName === 'tr').map(row => [...row.children].filter(cell => cell.localName === 'tc').map(cell => [...cell.getElementsByTagNameNS('*', 'p')].map(textOf).join(' / ').replace(/\|/g, '\\|').replace(/\n/g, ' ')));
        const width = Math.max(0, ...rows.map(row => row.length));
        if (width) {
          const lines = rows.map(row => `| ${Array.from({ length: width }, (_, index) => row[index] || '').join(' | ')} |`);
          lines.splice(1, 0, `| ${Array(width).fill('---').join(' | ')} |`);
          blocks.push(lines.join('\n'));
        }
      } else if (!['sectPr'].includes(child.localName)) walkBlocks(child);
    }
  };
  walkBlocks(bodyElement);
  const body = blocks.join('\n\n');
  if (!body.trim()) fail('No readable text was found in this Word document. Scanned images cannot be imported as notes.');
  const warnings = [];
  if (archive.names.some(path => /^word\/(media|embeddings)\//.test(path))) warnings.push('Images and embedded files are not imported. The preview contains the document text only.');
  if (archive.names.some(path => /^word\/(header|footer|footnotes|endnotes)/.test(path))) warnings.push('Headers, footers, footnotes, and endnotes are not included in this text import.');
  return noteResult([importedNote({ summary: shortSummary(body, name.replace(/\.[^.]+$/, '')), body })], warnings);
}

/** Parse locally without writing application state. Ordinary note imports always receive fresh IDs. */
export async function parseImport(file) {
  if (!file || typeof file.arrayBuffer !== 'function') fail('Choose a file to import.');
  if (file.size > MAX_FILE_BYTES) fail('Choose a file smaller than 30 MB.');
  const name = file.name || 'import.txt';
  const extension = name.split('.').pop().toLowerCase();
  if (!['md', 'txt', 'json', 'zip', 'xlsx', 'docx'].includes(extension)) fail('Choose a Markdown, text, JSON, ZIP, Word (.docx), or Excel (.xlsx) file.');
  let buffer;
  try { buffer = await file.arrayBuffer(); } catch { fail('The file could not be read. Select it again and retry.'); }
  if (buffer.byteLength > MAX_FILE_BYTES) fail('Choose a file smaller than 30 MB.');
  if (!buffer.byteLength) fail('The selected file is empty.');
  if (extension === 'zip') return parseZip(buffer);
  if (extension === 'xlsx') return parseXlsx(buffer);
  if (extension === 'docx') return parseDocx(buffer, name);
  const text = utf8(new Uint8Array(buffer));
  if (extension === 'json') {
    const parsed = parseJSON(text, 'file');
    if (isObject(parsed) && ('version' in parsed || 'maps' in parsed || 'theme' in parsed)) return { kind: 'backup', data: validateBackup(parsed) };
    const rows = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.notes) ? parsed.notes : [parsed];
    if (rows.length > MAX_NOTES) fail(`Import at most ${MAX_NOTES} notes at a time.`);
    return noteResult(rows.map((note, index) => importedNote(note, `JSON note ${index + 1}`)));
  }
  return noteResult(extension === 'md' ? parseMarkdown(text, name) : [importedNote({ summary: shortSummary(text, name.replace(/\.[^.]+$/, '')), body: text })]);
}
