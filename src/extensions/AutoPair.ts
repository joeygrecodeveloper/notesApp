import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';

const PAIRS: Record<string, string> = {
  '(':  ')',
  '[':  ']',
  '{':  '}',
  '"':  '"',
  "'":  "'",
};

// Single quote after these chars signals a contraction or possessive — don't auto-pair.
const CONTRACTION_CHARS = new Set(['I', 'n', 't', 's', 'e', 'u']);

function charAt(doc: Node, pos: number): string {
  if (pos < 0 || pos >= doc.content.size) return '';
  return doc.textBetween(pos, pos + 1, '');
}

export const AutoPair = Extension.create({
  name: 'autoPair',
  priority: 200,

  addKeyboardShortcuts() {
    const shortcuts: Record<string, () => boolean> = {};

    // ── Opening characters ──────────────────────────────────────────────────
    for (const [open, close] of Object.entries(PAIRS)) {
      shortcuts[open] = () => {
        const { state, dispatch } = this.editor.view;
        const { selection } = state;
        const { from, to, empty } = selection;

        // Wrap selection with the pair
        if (!empty) {
          const tr = state.tr
            .insertText(close, to)
            .insertText(open, from);
          dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1, to + 1)));
          return true;
        }

        // Single quote after a contraction/possessive char: insert bare ' and stop.
        if (open === "'" && CONTRACTION_CHARS.has(charAt(state.doc, from - 1))) {
          return false;
        }

        // Symmetric pair (" / '): skip over if the closing char is already next
        if (open === close && charAt(state.doc, from) === close) {
          dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)));
          return true;
        }

        // For quotes, only auto-pair when followed by whitespace or end of content.
        // If any other character is next, insert a bare quote and let the browser handle it.
        if (open === close) {
          const next = charAt(state.doc, from);
          if (next !== '' && next !== ' ' && next !== '\t') return false;
        }

        // Insert pair and place cursor between
        const tr = state.tr.insertText(open + close, from);
        dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1)));
        return true;
      };
    }

    // ── Closing characters: skip over instead of inserting ──────────────────
    for (const close of [')', ']', '}']) {
      shortcuts[close] = () => {
        const { state, dispatch } = this.editor.view;
        const { selection } = state;
        const { from, empty } = selection;

        if (!empty) return false;

        if (charAt(state.doc, from) === close) {
          dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)));
          return true;
        }
        return false;
      };
    }

    return shortcuts;
  },

  // ── Backspace: handled via handleKeyDown so it fires before beforeinput ───
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('autoPairBackspace'),
        props: {
          handleKeyDown(view, event) {
            if (event.key !== 'Backspace') return false;

            const { state, dispatch } = view;
            const { selection } = state;
            const { from, empty } = selection;

            if (!empty || from < 1) return false;

            const before = charAt(state.doc, from - 1);
            const after  = charAt(state.doc, from);

            if (before && PAIRS[before] === after) {
              dispatch(state.tr.delete(from - 1, from + 1));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
