import { Extension } from '@tiptap/core';

const FORMATTING_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'highlight']);

export const ClearFormattingOnEnter = Extension.create({
  name: 'clearFormattingOnEnter',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { storedMarks, selection: { $from } } = state;

        const activeMarks = storedMarks ?? $from.marks();
        const hasFormatting = activeMarks.some(mark => FORMATTING_MARKS.has(mark.type.name));

        if (!hasFormatting) return false;

        let inListItem = false;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'listItem') { inListItem = true; break; }
        }

        if (inListItem) {
          return editor.chain()
            .splitListItem('listItem')
            .command(({ tr }) => { tr.setStoredMarks([]); return true; })
            .run();
        }

        return editor.chain()
          .splitBlock()
          .command(({ tr }) => { tr.setStoredMarks([]); return true; })
          .run();
      },
    };
  },
});
