import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Strike from '@tiptap/extension-strike';
import Blockquote from '@tiptap/extension-blockquote';
import Link from '@tiptap/extension-link';
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { useState, useRef, useCallback, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { Note } from '../types';
import { updateCollapsedHeadings } from '../db';
import { AutoPair } from '../extensions/AutoPair';
import { ArrowList } from '../extensions/ArrowList';
import { ChevronList } from '../extensions/ChevronList';
import { Arrow } from '../extensions/Arrow';
import { CharacterColors } from '../extensions/CharacterColors';
import { ClearFormattingOnEnter } from '../extensions/ClearFormattingOnEnter';
import { SelectionDecoration } from '../extensions/SelectionDecoration';
import { CollapsibleHeadings } from '../extensions/CollapsibleHeadings';
import { UrlMention } from '../extensions/UrlMention';
import { StatusNode } from '../extensions/StatusNode';
import { TabIndent } from '../extensions/TabIndent';


const CustomBlockquote = Blockquote.extend({
  addInputRules() {
    return [];
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-b': () => this.editor.commands.toggleBlockquote(),
    };
  },
});

const CustomStrike = Strike.extend({
  addKeyboardShortcuts() {
    return {
      'Mod-.': () => this.editor.commands.toggleStrike(),
    };
  },
});

const DisableShiftEnter = Extension.create({
  name: 'disableShiftEnter',
  addKeyboardShortcuts() {
    return {
      'Shift-Enter': () => true,
    };
  },
});

const URL_TLD_RE = /\.(com|org|net|io|dev|app|co|edu|gov|uk|ca|de|fr|au|me|ai|tv|info|biz)(\/|$|\s)/i
const CODE_EXT_RE = /\.(ts|js|jsx|tsx|css|md|py|rs|json|html|vue|swift|kt|go|rb|cpp|c|h)(\s|$)/i

function isURL(text: string): boolean {
  if (CODE_EXT_RE.test(text)) return false
  return /^https?:\/\//i.test(text) || URL_TLD_RE.test(text)
}

const PastePlainText = Extension.create({
  name: 'pastePlainText',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData('text/plain') ?? '';
            console.log('[handlePaste] text:', text, '| hasSelection:', !view.state.selection.empty, '| isURL:', isURL(text));
            if (!text) return false;

            const { state } = view;
            const { selection } = state;
            const hasSelection = !selection.empty;

            if (hasSelection && isURL(text)) {
              console.log('[handlePaste] branch: selection + URL → hyperlink');
              const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
              view.dispatch(
                state.tr.addMark(
                  selection.from,
                  selection.to,
                  state.schema.marks.link.create({ href })
                )
              );
              return true;
            }

            if (!hasSelection && isURL(text)) {
              console.log('[handlePaste] branch: no selection + URL → urlMention');
              const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
              view.dispatch(
                state.tr.replaceSelectionWith(
                  state.schema.nodes.urlMention.create({ url: href, title: text, favicon: '', loading: true })
                )
              );
              return true;
            }

            console.log('[handlePaste] branch: plain text fallback');
            view.dispatch(state.tr.insertText(text));
            return true;
          },
        },
      }),
    ];
  },
});


interface LineRect { top: number; bottom: number; left: number; right: number }

function textNodeRects(range: Range): DOMRect[] {
  const rects: DOMRect[] = []
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode!
    : range.commonAncestorContainer

  // Rects from text nodes only — avoids block-element full-width rects
  const textIter = document.createNodeIterator(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = textIter.nextNode())) {
    const text = node as Text
    if (!range.intersectsNode(text)) continue
    const sub = document.createRange()
    sub.setStart(text, text === range.startContainer ? range.startOffset : 0)
    sub.setEnd(text, text === range.endContainer ? range.endOffset : text.length)
    if (!sub.collapsed) for (const r of sub.getClientRects()) rects.push(r)
  }

  // 8px placeholder rects for blank paragraphs — keeps the polygon closed over empty lines
  const elemIter = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT)
  while ((node = elemIter.nextNode())) {
    const el = node as Element
    if (el.tagName !== 'P') continue
    if (!range.intersectsNode(el)) continue
    if ((el.textContent ?? '').replace(/​/g, '').trim()) continue
    const r = el.getBoundingClientRect()
    if (r.height > 0.5) rects.push(new DOMRect(r.left, r.top, 8, r.height))
  }

  return rects
}

function groupByLine(rects: DOMRect[], cr: DOMRect): LineRect[] {
  const translated = Array.from(rects)
    .filter(r => r.width > 0.5 && r.height > 0.5)
    .map(r => ({ top: r.top - cr.top, bottom: r.bottom - cr.top, left: r.left - cr.left, right: r.right - cr.left }))
    .sort((a, b) => a.top !== b.top ? a.top - b.top : a.left - b.left)
  if (!translated.length) return []
  const lines: LineRect[] = []
  let cur = { ...translated[0] }
  for (let i = 1; i < translated.length; i++) {
    const r = translated[i]
    if (Math.abs(r.top - cur.top) < 2) {
      cur.left = Math.min(cur.left, r.left)
      cur.right = Math.max(cur.right, r.right)
      cur.bottom = Math.max(cur.bottom, r.bottom)
    } else {
      lines.push(cur)
      cur = { ...r }
    }
  }
  lines.push(cur)
  return lines
}

function buildSelectionPath(lines: LineRect[], r = 3): string {
  if (!lines.length) return ''

  // Collect ordered corner vertices of the stepped polygon (clockwise)
  const pts: [number, number][] = []
  pts.push([lines[0].right, lines[0].top])
  for (let i = 0; i < lines.length - 1; i++) {
    pts.push([lines[i].right,     lines[i].bottom])
    pts.push([lines[i + 1].right, lines[i].bottom])      // H to new right edge at same y
    pts.push([lines[i + 1].right, lines[i + 1].top])     // V down to next line top
  }
  pts.push([lines[lines.length - 1].right, lines[lines.length - 1].bottom])
  pts.push([lines[lines.length - 1].left,  lines[lines.length - 1].bottom])
  for (let i = lines.length - 1; i > 0; i--) {
    pts.push([lines[i].left,     lines[i].top])
    pts.push([lines[i - 1].left, lines[i].top])           // H to new left edge at same y
    pts.push([lines[i - 1].left, lines[i - 1].bottom])   // V up to prev line bottom
  }
  pts.push([lines[0].left, lines[0].top])

  // Drop consecutive duplicates (equal-width adjacent lines produce zero-length segments)
  const verts: [number, number][] = []
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i]
    const [px, py] = pts[(i - 1 + pts.length) % pts.length]
    if (Math.abs(x - px) > 0.01 || Math.abs(y - py) > 0.01) verts.push([x, y])
  }

  const n = verts.length
  if (n < 2) return ''

  const unit = (a: [number, number], b: [number, number]): [number, number] => {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    return len < 0.001 ? [0, 0] : [dx / len, dy / len]
  }

  // For each vertex, arc start = r units before, arc end = r units after (clamped to segment midpoints)
  let d = ''
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n]
    const curr = verts[i]
    const next = verts[(i + 1) % n]

    const inLen  = Math.hypot(curr[0] - prev[0], curr[1] - prev[1])
    const outLen = Math.hypot(next[0] - curr[0], next[1] - curr[1])
    const cr = Math.min(r, inLen / 2, outLen / 2)

    const dIn  = unit(prev, curr)
    const dOut = unit(curr, next)

    const sx = curr[0] - cr * dIn[0],  sy = curr[1] - cr * dIn[1]
    const ex = curr[0] + cr * dOut[0], ey = curr[1] + cr * dOut[1]

    d += i === 0 ? `M${sx},${sy}` : ` L${sx},${sy}`
    d += ` Q${curr[0]},${curr[1]} ${ex},${ey}`
  }

  return d + ' Z'
}

interface EditorProps {
  note: Note;
  autoFocus?: boolean;
  onTitleChange: (id: string, title: string) => void;
  onSave: (id: string, title: string, body: string) => void;
  onCollapsedHeadingsChange: (id: string, json: string) => void;
}

export function Editor({ note, autoFocus, onTitleChange, onSave, onCollapsedHeadingsChange }: EditorProps) {
  const [title, setTitle] = useState(note.title);
  const [selectionPath, setSelectionPath] = useState('');
  const titleRef = useRef(note.title);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedSave = useCallback(
    (t: string, body: string) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSave(note.id, t, body);
      }, 500);
    },
    [note.id, onSave]
  );

  const updateSelectionOverlay = useCallback(() => {
    const container = containerRef.current;
    const domSel = window.getSelection();
    if (!container || !domSel || domSel.isCollapsed || !domSel.rangeCount) {
      setSelectionPath('');
      return;
    }
    const rects = textNodeRects(domSel.getRangeAt(0));
    if (!rects.length) { setSelectionPath(''); return; }
    const lines = groupByLine(rects, container.getBoundingClientRect());
    setSelectionPath(buildSelectionPath(lines));
  }, []);

  const initialCollapsed: Record<string, boolean> = (() => {
    try { return note.collapsed_headings ? JSON.parse(note.collapsed_headings) : {} }
    catch { return {} }
  })()

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ strike: false, blockquote: false, hardBreak: false, link: false }),
      Link.configure({ openOnClick: false }),
      CustomStrike,
      CustomBlockquote,
      DisableShiftEnter,
      PastePlainText,
      AutoPair,
      ArrowList,
      ChevronList,
      Arrow,
      CharacterColors,
      ClearFormattingOnEnter,
      SelectionDecoration,
      CollapsibleHeadings.configure({
        initialCollapsed,
        onToggle: (json: string) => {
          updateCollapsedHeadings(note.id, json).catch(err =>
            console.error('[Editor] failed to save collapsed_headings:', err)
          )
          onCollapsedHeadingsChange(note.id, json)
        },
      }),
      UrlMention,
      StatusNode,
      TabIndent,
    ],
    content: note.body ? JSON.parse(note.body) : '',
    onUpdate: ({ editor }) => {
      debouncedSave(titleRef.current, JSON.stringify(editor.getJSON()));
    },
    onSelectionUpdate: updateSelectionOverlay,
    onBlur: () => setSelectionPath(''),
  });

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus('end');
  }, [autoFocus, editor]);

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen('rich-paste-shortcut', () => {
      const hasSelection = !editor.state.selection.empty;

      (async () => {
        try {
          const items = await navigator.clipboard.read();
          console.log('[richPaste] clipboard item types:', items.map(i => i.types));
          for (const item of items) {
            if (item.types.includes('text/html')) {
              const html = await item.getType('text/html').then(b => b.text());
              console.log('[richPaste] raw HTML from clipboard:', html);
              editor.commands.insertContent(html);
              console.log('[richPaste] insertContent called with HTML');
              return;
            }
            if (item.types.includes('text/plain')) {
              const text = await item.getType('text/plain').then(b => b.text());
              console.log('[richPaste] plain text from clipboard:', text);
              if (isURL(text)) {
                const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
                if (hasSelection) {
                  console.log('[richPaste] selection + URL detected');
                  const { state } = editor.view;
                  const { selection } = state;
                  editor.view.dispatch(
                    state.tr.addMark(selection.from, selection.to, state.schema.marks.link.create({ href }))
                  );
                } else {
                  console.log('[richPaste] no selection + URL → inserting plain text');
                  editor.commands.insertContent(text);
                }
              } else {
                editor.commands.insertContent(text);
                console.log('[richPaste] insertContent called with plain text');
              }
              return;
            }
          }
          console.log('[richPaste] no usable clipboard type found');
        } catch (err) {
          console.log('[richPaste] clipboard.read() failed, falling back to readText(). Error:', err);
          const text = await navigator.clipboard.readText().catch(e => {
            console.log('[richPaste] readText() also failed:', e);
            return '';
          });
          if (text) {
            if (isURL(text)) {
              const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
              if (hasSelection) {
                console.log('[richPaste] selection + URL detected (fallback)');
                const { state } = editor.view;
                const { selection } = state;
                editor.view.dispatch(
                  state.tr.addMark(selection.from, selection.to, state.schema.marks.link.create({ href }))
                );
              } else {
                console.log('[richPaste] no selection + URL → inserting plain text (fallback)');
                editor.commands.insertContent(text);
              }
            } else {
              editor.commands.insertContent(text);
              console.log('[richPaste] insertContent called with readText() fallback:', text);
            }
          }
        }
      })();
    }).then(fn => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [editor]);

  useEffect(() => {
    if (note.title !== title) {
      setTitle(note.title);
    }
  }, [note.title]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = e.target.value;
    setTitle(t);
    titleRef.current = t;
    onTitleChange(note.id, t);
    debouncedSave(t, editor ? JSON.stringify(editor.getJSON()) : note.body);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editor?.commands.focus('start');
    }
  };

  return (
    <div className="editor-container" ref={containerRef}>
      <input
        className="editor-title"
        value={title}
        onChange={handleTitleChange}
        onKeyDown={handleTitleKeyDown}
        placeholder="Untitled"
      />
      {selectionPath && (
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
          <path d={selectionPath} fill="hsla(210, 13%, 48%, 0.85)" stroke="hsl(210, 13%, 55%)" strokeWidth={1} fillRule="nonzero" />
        </svg>
      )}
      <EditorContent editor={editor} className="editor-content" spellCheck={true} />
    </div>
  );
}
