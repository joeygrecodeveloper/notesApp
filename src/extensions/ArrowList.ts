import { Node, mergeAttributes, InputRule } from '@tiptap/core'
import { TextSelection, Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const ArrowListItem = Node.create({
  name: 'arrowListItem',
  content: 'paragraph+',

  addAttributes() {
    return {
      indent: {
        default: 0,
        parseHTML: el => parseInt(el.getAttribute('data-indent') ?? '0', 10),
        renderHTML: attrs => ({ 'data-indent': attrs.indent }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'li.arrow-list-item' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['li', mergeAttributes(HTMLAttributes, { class: 'arrow-list-item' }), 0]
  },

  addNodeView() {
    return ({ node }) => {
      const li = document.createElement('li')
      li.className = 'arrow-list-item'
      li.setAttribute('data-indent', String(node.attrs.indent ?? 0))

      const marker = document.createElement('span')
      marker.className = 'arrow-marker'
      marker.setAttribute('contenteditable', 'false')
      marker.setAttribute('aria-hidden', 'true')

      const content = document.createElement('div')
      content.className = 'arrow-content'

      li.appendChild(marker)
      li.appendChild(content)

      return {
        dom: li,
        contentDOM: content,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false
          li.setAttribute('data-indent', String(updatedNode.attrs.indent ?? 0))
          return true
        },
      }
    }
  },
})

export const ArrowList = Node.create({
  name: 'arrowList',
  group: 'block',
  content: 'arrowListItem+',

  parseHTML() {
    return [{ tag: 'ul[data-type="arrowList"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['ul', mergeAttributes(HTMLAttributes, { 'data-type': 'arrowList', class: 'arrow-list' }), 0]
  },

  addExtensions() {
    return [ArrowListItem]
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^>>$/,
        handler: ({ state, range }) => {
          const paraType          = this.editor.schema.nodes.paragraph
          const arrowListItemType = this.editor.schema.nodes.arrowListItem
          if (!paraType || !arrowListItemType) return

          const $from    = state.doc.resolve(range.from)
          const nodeFrom = $from.before($from.depth)
          const nodeTo   = $from.after($from.depth)

          const item      = arrowListItemType.create(null, paraType.create(null))
          const arrowList = this.type.create(null, [item])

          state.tr.replaceWith(nodeFrom, nodeTo, arrowList)
          // nodeFrom +1 (arrowList open) +1 (arrowListItem open) +1 (para open) = nodeFrom+3
          state.tr.setSelection(TextSelection.create(state.tr.doc, nodeFrom + 3))
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    const arrowListName = this.name
    const listItemName  = 'arrowListItem'
    return [
      new Plugin({
        props: {
          decorations(state) {
            const { doc } = state
            const decos: Decoration[] = []
            doc.forEach((node, offset) => {
              if (node.type.name !== arrowListName) return
              node.forEach((child, childOffset, index) => {
                if (child.type.name !== listItemName) return
                const absPos = offset + 1 + childOffset
                if (index === 0) return
                decos.push(
                  Decoration.node(absPos, absPos + child.nodeSize, {
                    class: 'arrow-list-item-continuation',
                  })
                )
              })
            })
            return DecorationSet.create(doc, decos)
          },
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    const inArrowListItem = ($from: ReturnType<typeof this.editor.state.selection.$from>) =>
      $from.parent.type.name === 'paragraph' &&
      $from.node($from.depth - 1)?.type.name === 'arrowListItem' &&
      $from.node($from.depth - 2)?.type.name === this.name

    return {
      Tab: () => {
        const { state, view } = this.editor
        const { $from } = state.selection
        if (!inArrowListItem($from)) return false

        const item    = $from.node($from.depth - 1)
        const itemPos = $from.before($from.depth - 1)
        const indent  = (item.attrs.indent as number) ?? 0

        view.dispatch(state.tr.setNodeMarkup(itemPos, null, { ...item.attrs, indent: indent + 1 }))
        return true
      },

      'Shift-Tab': () => {
        const { state, view } = this.editor
        const { $from } = state.selection
        if (!inArrowListItem($from)) return false

        const item    = $from.node($from.depth - 1)
        const itemPos = $from.before($from.depth - 1)
        const indent  = (item.attrs.indent as number) ?? 0

        if (indent <= 0) return true  // block browser default, but no-op

        view.dispatch(state.tr.setNodeMarkup(itemPos, null, { ...item.attrs, indent: indent - 1 }))
        return true
      },

      Backspace: () => {
        const { state } = this.editor
        const { $from, empty } = state.selection
        if (!empty || $from.parent.type.name !== 'arrowListItem' || $from.parentOffset !== 0) return false
        const indent = ($from.parent.attrs.indent as number) ?? 0
        if (indent > 0) {
          return this.editor.commands.updateAttributes('arrowListItem', { indent: indent - 1 })
        }
        return this.editor.commands.setNode('paragraph')
      },

      Enter: () => {
        const { state, view } = this.editor
        const { $from, empty } = state.selection
        const firstChild = $from.parent.firstChild

        if (empty && inArrowListItem($from)) {
          const item          = $from.node($from.depth - 1)
          const currentIndent = (item.attrs.indent as number) ?? 0

          // Double-Enter: empty item exits the list entirely
          if ($from.parent.content.size === 0) {
            return this.editor.commands.liftListItem('arrowListItem')
          }

          const paraType          = this.editor.schema.nodes.paragraph
          const arrowListItemType = this.editor.schema.nodes.arrowListItem
          if (!paraType || !arrowListItemType) return false

          const itemFrom      = $from.before($from.depth - 1)
          const itemTo        = $from.after($from.depth - 1)
          const beforeContent = $from.parent.content.cut(0, $from.parentOffset)
          const afterContent  = $from.parent.content.cut($from.parentOffset)

          const item1 = arrowListItemType.create({ indent: currentIndent }, paraType.create(null, beforeContent))
          const item2 = arrowListItemType.create({ indent: currentIndent }, paraType.create(null, afterContent))

          const tr = state.tr.replaceWith(itemFrom, itemTo, [item1, item2])
          // itemFrom + item1.nodeSize = item2 open; +1 para2 open; +1 = para2 content start
          tr.setSelection(TextSelection.create(tr.doc, itemFrom + item1.nodeSize + 2))
          tr.scrollIntoView()
          view.dispatch(tr)
          return true
        }

        // Backward-compat: convert paragraphs that still contain an inline Arrow node
        // (notes saved before the InputRule approach was introduced)
        if (!empty || $from.parent.type.name !== 'paragraph' || firstChild?.type.name !== 'arrow' || firstChild?.attrs.direction !== 'right') {
          return false
        }

        const paraType          = this.editor.schema.nodes.paragraph
        const arrowListItemType = this.editor.schema.nodes.arrowListItem
        if (!paraType || !arrowListItemType) return false

        const arrowSize    = firstChild.nodeSize
        const splitAt      = Math.max($from.parentOffset, arrowSize)
        const beforeCursor = $from.parent.content.cut(arrowSize, splitAt)
        const afterCursor  = $from.parent.content.cut(splitAt)

        const item1     = arrowListItemType.create(null, paraType.create(null, beforeCursor))
        const item2     = arrowListItemType.create(null, paraType.create(null, afterCursor))
        const arrowList = this.type.create(null, [item1, item2])

        const nodeFrom  = $from.before()
        const nodeTo    = $from.after()
        const cursorPos = nodeFrom + item1.nodeSize + 3

        const tr = state.tr.replaceWith(nodeFrom, nodeTo, arrowList)
        tr.setSelection(TextSelection.create(tr.doc, cursorPos))
        tr.scrollIntoView()
        view.dispatch(tr)
        return true
      },
    }
  },
})
