import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Strike from '@tiptap/extension-strike';
import Blockquote from '@tiptap/extension-blockquote';
import { useState, useRef, useCallback, useEffect } from 'react';
import { AutoPair } from '../extensions/AutoPair';
import { ArrowList } from '../extensions/ArrowList';
import { Arrow } from '../extensions/Arrow';
import { CharacterColors } from '../extensions/CharacterColors';
import { ClearFormattingOnEnter } from '../extensions/ClearFormattingOnEnter';
import { SelectionDecoration } from '../extensions/SelectionDecoration';

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
import type { Note } from '../types';

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
      StarterKit.configure({ strike: false, blockquote: false }),
      CustomStrike,
      CustomBlockquote,
      AutoPair,
      ArrowList,
      Arrow,
      CharacterColors,
      ClearFormattingOnEnter,
      SelectionDecoration,
    ],
    content: note.body ? JSON.parse(note.body) : '',
    onUpdate: ({ editor }) => {
      debouncedSave(titleRef.current, JSON.stringify(editor.getJSON()));
    },
  });

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus('end');
  }, [autoFocus, editor]);

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
