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


interface EditorProps {
  note: Note;
  autoFocus?: boolean;
  onTitleChange: (id: string, title: string) => void;
  onSave: (id: string, title: string, body: string) => void;
  onCollapsedHeadingsChange: (id: string, json: string) => void;
}

export function Editor({ note, autoFocus, onTitleChange, onSave, onCollapsedHeadingsChange }: EditorProps) {
  const [title, setTitle] = useState(note.title);
  const titleRef = useRef(note.title);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const debouncedSave = useCallback(
    (t: string, body: string) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSave(note.id, t, body);
      }, 500);
    },
    [note.id, onSave]
  );

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
    <div className="editor-container">
      <input
        className="editor-title"
        value={title}
        onChange={handleTitleChange}
        onKeyDown={handleTitleKeyDown}
        placeholder="Untitled"
      />
<EditorContent editor={editor} className="editor-content" spellCheck={true} />
    </div>
  );
}
