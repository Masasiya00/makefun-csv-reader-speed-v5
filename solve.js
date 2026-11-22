// Fast drop-in for csv-reader 1.0.0 (make.fun's reference CSV reader).
// Same answers - {columns, rows, errors} - but the text is never walked
// one character at a time and never scanned twice for the same delimiter:
//
//   - an unquoted field ends at the nearest of ',', '\n', '\r', found by
//     ONE native regex exec (/[,\r\n]/g) instead of three indexOf scans;
//     a lone CR is the only reason to scan again (stray_cr, rare);
//   - a quoted field jumps from quote-or-line-break to quote-or-line-break
//     with ONE regex (/["\r\n]/g): a span between two stops never holds a
//     CR or LF, so it is one slice and never rebuilt; '""' contributes one
//     '"' and the scan continues, the closing quote ends the field;
//   - the driver reads /input/cases.json as a Buffer and lets JSON.parse
//     decode it, and main.ts tunes V8 with a large semi-space plus
//     single-generation mode, which measured ~10% faster here than the
//     default heap layout (see README).
//
// Pure JavaScript, no dependencies, no WASM, no native code.

const DELIM = /[,\r\n]/g;
const QUOTE = /["\r\n]/g;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // ended: 0 = comma (record goes on), 1 = line break (record ends),
  // 2 = end of text (record ends).
  let fieldValue = '';
  let ended = 2;

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;

    do {
      if (text.charCodeAt(pos) === 34) {
        // ---- quoted field ----
        quoted = true;
        const open = pos;
        const openLine = line;
        let segStart = pos + 1; // start of the current content span
        let scan = segStart; // where the next quote/line-break search starts
        let parts = null; // string[] once a doubled quote / CR / LF forces assembly
        let value = '';
        let closed = false;

        while (!closed) {
          QUOTE.lastIndex = scan;
          const m = QUOTE.exec(text);
          if (m === null) {
            // The quote never closes: it is a literal character, and the
            // text after it is read again as an unquoted field.
            pos = open + 1;
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            // Re-read as unquoted, starting value '"'. (Rare path.)
            let acc = '"';
            let start = pos;
            for (;;) {
              DELIM.lastIndex = start;
              const d = DELIM.exec(text);
              if (d === null) {
                if (start < len) acc += text.slice(start);
                pos = len;
                ended = 2;
                break;
              }
              const e = d.index;
              const cc = text.charCodeAt(e);
              if (cc === 13) {
                if (e + 1 < len && text.charCodeAt(e + 1) === 10) {
                  if (e > start) acc += text.slice(start, e);
                  pos = e + 2;
                  line += 1;
                  ended = 1;
                  break;
                }
                errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                if (e > start) acc += text.slice(start, e);
                start = e + 1;
                continue;
              }
              if (cc === 44) {
                if (e > start) acc += text.slice(start, e);
                pos = e + 1;
                ended = 0;
              } else {
                if (e > start) acc += text.slice(start, e);
                pos = e + 1;
                line += 1;
                ended = 1;
              }
              break;
            }
            fieldValue = acc;
            break;
          }

          const q = m.index;
          const cc = text.charCodeAt(q);
          if (cc === 34) {
            const doubled = q + 1 < len && text.charCodeAt(q + 1) === 34;
            if (doubled) {
              if (parts === null) parts = [];
              parts.push(text.slice(segStart, q));
              parts.push('"');
              scan = q + 2;
              segStart = q + 2;
              continue;
            }
            value = parts === null ? text.slice(segStart, q) : (parts.push(text.slice(segStart, q)), parts.join(''));
            pos = q + 1;
            closed = true;
            break;
          }
          // CR or LF inside quotes reads as LF; CRLF counts as one line.
          if (parts === null) parts = [];
          parts.push(text.slice(segStart, q));
          parts.push('\n');
          line += 1;
          if (cc === 13 && q + 1 < len && text.charCodeAt(q + 1) === 10) {
            scan = q + 2;
            segStart = q + 2;
          } else {
            scan = q + 1;
            segStart = q + 1;
          }
        }

        if (closed) {
          if (pos >= len) {
            fieldValue = value;
            ended = 2;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              fieldValue = value;
              ended = 0;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              fieldValue = value;
              ended = 1;
            } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              fieldValue = value;
              ended = 1;
            } else {
              // Junk after the closing quote is appended as it stands,
              // up to the next comma or line break. (Rare path.)
              let acc = value;
              let added = 0;
              let start = pos;
              for (;;) {
                DELIM.lastIndex = start;
                const d = DELIM.exec(text);
                if (d === null) {
                  if (start < len) { acc += text.slice(start); added += len - start; }
                  pos = len;
                  ended = 2;
                  break;
                }
                const e = d.index;
                const cc = text.charCodeAt(e);
                if (cc === 13) {
                  if (e + 1 < len && text.charCodeAt(e + 1) === 10) {
                    if (e > start) { acc += text.slice(start, e); added += e - start; }
                    pos = e + 2;
                    line += 1;
                    ended = 1;
                    break;
                  }
                  errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                  if (e > start) { acc += text.slice(start, e); added += e - start; }
                  start = e + 1;
                  continue;
                }
                if (cc === 44) {
                  if (e > start) { acc += text.slice(start, e); added += e - start; }
                  pos = e + 1;
                  ended = 0;
                } else {
                  if (e > start) { acc += text.slice(start, e); added += e - start; }
                  pos = e + 1;
                  line += 1;
                  ended = 1;
                }
                break;
              }
              fieldValue = acc;
              if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
          }
        }
      } else {
        // ---- unquoted field ----
        quoted = false;
        let acc = null; // only built when a lone CR forces a second scan
        let start = pos;
        for (;;) {
          DELIM.lastIndex = start;
          const d = DELIM.exec(text);
          if (d === null) {
            fieldValue = acc === null ? text.slice(pos) : acc + text.slice(start);
            pos = len;
            ended = 2;
            break;
          }
          const e = d.index;
          const cc = text.charCodeAt(e);
          if (cc === 13) {
            if (e + 1 < len && text.charCodeAt(e + 1) === 10) {
              fieldValue = acc === null ? text.slice(pos, e) : acc + text.slice(start, e);
              pos = e + 2;
              line += 1;
              ended = 1;
              break;
            }
            // Lone CR outside quotes is dropped (stray_cr).
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            acc = acc === null ? text.slice(pos, e) : acc + text.slice(start, e);
            start = e + 1;
            continue;
          }
          if (cc === 44) {
            fieldValue = acc === null ? text.slice(pos, e) : acc + text.slice(start, e);
            pos = e + 1;
            ended = 0;
          } else {
            fieldValue = acc === null ? text.slice(pos, e) : acc + text.slice(start, e);
            pos = e + 1;
            line += 1;
            ended = 1;
          }
          break;
        }
      }
      fields.push(fieldValue);
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
