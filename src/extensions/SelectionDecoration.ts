import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const selectionDecoKey = new PluginKey<DecorationSet>('selectionDecoration');

export const SelectionDecoration = Extension.create({
  name: 'selectionDecoration',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: selectionDecoKey,
        state: {
          init(_, { doc, selection }) {
            if (selection.empty) return DecorationSet.empty;
            return DecorationSet.create(doc, [
              Decoration.inline(selection.from, selection.to, { class: 'pm-selection' }),
            ]);
          },
          apply(tr, prevDecorations) {
            if (!tr.selectionSet && !tr.docChanged) return prevDecorations;
            const { selection } = tr;
            if (selection.empty) return DecorationSet.empty;
            return DecorationSet.create(tr.doc, [
              Decoration.inline(selection.from, selection.to, { class: 'pm-selection' }),
            ]);
          },
        },
        props: {
          decorations(state) {
            return selectionDecoKey.getState(state);
          },
        },
      }),
    ];
  },
});
