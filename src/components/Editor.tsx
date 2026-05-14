import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Strike from '@tiptap/extension-strike';
import Blockquote from '@tiptap/extension-blockquote';
import Link from '@tiptap/extension-link';
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Note } from '../types';
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
}

export function Editor({ note, autoFocus, onTitleChange, onSave }: EditorProps) {
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
      CollapsibleHeadings,
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
