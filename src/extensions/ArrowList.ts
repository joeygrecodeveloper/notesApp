import { Node, mergeAttributes } from '@tiptap/core'
import { TextSelection, Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const MAX_INDENT = 6

export const ArrowListItem = Node.create({
  name: 'arrowListItem',
  group: 'block',
  content: 'inline*',
  priority: 200,

  addAttributes() {
    return {
      indent: {
        default: 0,
        parseHTML: el => parseInt(el.getAttribute('data-indent') ?? '0', 10),
        renderHTML: attrs => attrs.indent > 0 ? { 'data-indent': attrs.indent } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="arrowListItem"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'arrowListItem', class: 'arrow-list-item' }), 0]
  },

  addProseMirrorPlugins() {
    console.log('[ArrowList] plugin initialized | this.name:', this.name, '| schema nodes:', Object.keys(this.editor.schema.nodes).join(', '))
    const typeName = this.name
    return [
      new Plugin({
        props: {
          decorations(state) {
            const { doc } = state
            const decos: Decoration[] = []
            let arrowListItemCount = 0
            const topLevelNames: string[] = []
            doc.forEach((node, offset, index) => {
              topLevelNames.push(node.type.name)
              if (node.type.name === typeName) arrowListItemCount++
              if (node.type.name !== typeName || index === 0) return
              if (doc.child(index - 1).type.name === typeName) {
                console.log('[ArrowList] adding continuation class to node at pos', offset)
                decos.push(
                  Decoration.node(offset, offset + node.nodeSize, {
                    class: 'arrow-list-item-continuation',
                  })
                )
              }
            })
            console.log('[ArrowList] decorations running | typeName:', typeName, '| found:', arrowListItemCount, '| top-level types:', topLevelNames.join(', '))
            return DecorationSet.create(doc, decos)
          },
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        console.log('[ArrowList] Enter handler fired')
        const { state, view } = this.editor
        const { $from, empty } = state.selection
        const firstChild = $from.parent.firstChild

        const parentTypeName = $from.parent.type.name
        const contentSize = $from.parent.content.size
        const parentOffset = $from.parentOffset
        const firstChildTypeName = firstChild?.type.name ?? '(none)'
        const firstChildDir = firstChild?.attrs?.direction ?? '(none)'

        console.log('[ArrowList] Enter conditions:', {
          empty,
          parentTypeName,
          contentSize,
          parentOffset,
          firstChildTypeName,
          firstChildDir,
        })

        // ── Trigger: paragraph whose first child is an arrow atom ──
        if (empty && parentTypeName === 'paragraph' && firstChildTypeName === 'arrow') {
          console.log('[ArrowList] trigger branch entered | schema nodes:', Object.keys(this.editor.schema.nodes).join(', '))

          // Strip the arrow atom from the paragraph content, then split at cursor.
          // arrowSize is always 1 for an atom, but read it defensively.
          const arrowSize = firstChild!.nodeSize
          // clamp: cursor could theoretically be before the atom (parentOffset < arrowSize)
          const splitAt = Math.max($from.parentOffset, arrowSize)

          const contentBefore = $from.parent.content.cut(arrowSize, splitAt)
          const contentAfter  = $from.parent.content.cut(splitAt)

          const nodeFrom   = $from.before()
          const nodeTo     = $from.after()
          const firstItem  = this.type.create({ indent: 0 }, contentBefore)
          const secondItem = this.type.create({ indent: 0 }, contentAfter)
          // nodeFrom + firstItem.nodeSize + 1 = past firstItem's closing token = inside secondItem
          const cursorPos  = nodeFrom + firstItem.nodeSize + 1

          console.log('[ArrowList] creating items | contentBefore.size:', contentBefore.size, '| contentAfter.size:', contentAfter.size, '| cursorPos:', cursorPos)

          const tr = state.tr.replaceWith(nodeFrom, nodeTo, [firstItem, secondItem])
          tr.setSelection(TextSelection.create(tr.doc, cursorPos))
          view.dispatch(tr)
          return true
        }

        // ── Inside arrowListItem ──
        if (!empty || parentTypeName !== this.name) return false

        // Empty item: dedent first if indented, otherwise exit to paragraph
        if ($from.parent.content.size === 0) {
          const indent = $from.parent.attrs.indent ?? 0
          if (indent > 0) {
            return this.editor.commands.updateAttributes(this.name, { indent: indent - 1 })
          }
          return this.editor.commands.setNode('paragraph')
        }

        // Non-empty: split into two arrowListItem nodes, preserving attrs
        const node = $from.parent
        const contentBefore = node.content.cut(0, $from.parentOffset)
        const contentAfter = node.content.cut($from.parentOffset)
        const nodeFrom = $from.before()
        const nodeTo = $from.after()

        const newItem1 = this.type.create(node.attrs, contentBefore)
        const newItem2 = this.type.create(node.attrs, contentAfter)
        const cursorPos = nodeFrom + newItem1.nodeSize + 1

        const tr = state.tr.replaceWith(nodeFrom, nodeTo, [newItem1, newItem2])
        tr.setSelection(TextSelection.create(tr.doc, cursorPos))
        view.dispatch(tr)

        return true
      },

      Tab: () => {
        const { $from } = this.editor.state.selection
        if ($from.parent.type.name !== this.name) return false
        const indent = $from.parent.attrs.indent ?? 0
        if (indent >= MAX_INDENT) return true
        return this.editor.commands.updateAttributes(this.name, { indent: indent + 1 })
      },

      'Shift-Tab': () => {
        const { $from } = this.editor.state.selection
        if ($from.parent.type.name !== this.name) return false
        const indent = $from.parent.attrs.indent ?? 0
        if (indent <= 0) return true
        return this.editor.commands.updateAttributes(this.name, { indent: indent - 1 })
      },

      Backspace: () => {
        const { state } = this.editor
        const { $from, empty } = state.selection
        if (!empty || $from.parent.type.name !== this.name || $from.parentOffset !== 0) return false
        const indent = $from.parent.attrs.indent ?? 0
        if (indent > 0) {
          return this.editor.commands.updateAttributes(this.name, { indent: indent - 1 })
        }
        return this.editor.commands.setNode('paragraph')
      },
    }
  },
})
