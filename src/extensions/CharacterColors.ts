import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node } from '@tiptap/pm/model';

const CHAR_COLORS: Record<string, string> = {
  '(': '#ABD9FB', ')': '#ABD9FB',
  '{': '#E1E10F', '}': '#E1E10F',
  '[': '#E1E10F', ']': '#E1E10F',
  '"': '#FF9492', '“': '#FF9492', '”': '#FF9492',
  "'": '#CFADF1', '‘': '#CFADF1', '’': '#CFADF1',
  '0': '#FFAA43', '1': '#FFAA43', '2': '#FFAA43', '3': '#FFAA43', '4': '#FFAA43',
  '5': '#FFAA43', '6': '#FFAA43', '7': '#FFAA43', '8': '#FFAA43', '9': '#FFAA43',
  '•': '#37B7B5',
  '.': '#FD6E4D',
  '?': '#939196',
  '!': '#EC4B4B',
  '>': '#6699CC',
  '<': '#6699CC',
  '-': '#0FBC7A',
  '@': '#72EF87',
  '&': '#CFADF1',
  '*': '#E1E10F',
  '%': '#6699CC',
  '$': '#72EF87',
  '/': '#EC4B4B',
  '\\': '#EC4B4B',
};

function buildDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    const end = pos + text.length;

    // Mark-based decorations — pushed first so per-character colors take priority
    const isBold = node.marks.some(m => m.type.name === 'bold');

    if (isBold) {
      decorations.push(Decoration.inline(pos, end, { style: 'color: #626868' }));
    }

    // Character-based decorations — pushed last, so they win over mark colors in CSS
    for (let i = 0; i < text.length; i++) {
      const color = CHAR_COLORS[text[i]];
      if (color) {
        decorations.push(
          Decoration.inline(pos + i, pos + i + 1, { style: `color: ${color}` })
        );
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

const charColorsKey = new PluginKey<DecorationSet>('characterColors');

export const CharacterColors = Extension.create({
  name: 'characterColors',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: charColorsKey,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc);
          },
          apply(tr, decorations) {
            if (!tr.docChanged) return decorations.map(tr.mapping, tr.doc);
            return buildDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return charColorsKey.getState(state);
          },
        },
      }),
    ];
  },
});
