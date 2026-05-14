import { Extension } from '@tiptap/core'
import type { ResolvedPos } from '@tiptap/pm/model'

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem', 'arrowListItem', 'chevronListItem'])

function inPlainParagraph($from: ResolvedPos): boolean {
  return (
    $from.parent.type.name === 'paragraph' &&
    !LIST_ITEM_TYPES.has($from.node($from.depth - 1)?.type.name ?? '')
  )
}

export const TabIndent = Extension.create({
  name: 'tabIndent',

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        console.log('[TabIndent] handler fired')
        const { state, view } = this.editor
        const { $from } = state.selection
        if (!inPlainParagraph($from)) return false

        view.dispatch(state.tr.insertText('    ', $from.pos))
        return true
      },

      'Shift-Tab': () => {
        const { state, view } = this.editor
        const { $from } = state.selection
        if (!inPlainParagraph($from)) return false

        const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)

        if (textBefore.startsWith('    ')) {
          view.dispatch(state.tr.delete($from.start(), $from.start() + 4))
        }
        return true
      },

      Backspace: () => {
        const { state, view } = this.editor
        const { $from, empty } = state.selection

        for (let depth = $from.depth; depth > 0; depth--) {
          const nodeType = $from.node(depth).type.name
          if (nodeType === 'listItem' || nodeType === 'arrowListItem') return false
        }

        if (!empty || !inPlainParagraph($from)) return false

        const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)

        if (textBefore.endsWith('    ')) {
          view.dispatch(state.tr.delete($from.pos - 4, $from.pos))
          return true
        }
        return false
      },
    }
  },
})
