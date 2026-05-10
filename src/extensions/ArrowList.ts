import { Node, mergeAttributes, InputRule } from '@tiptap/core'
import { TextSelection, Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const ArrowListItem = Node.create({
  name: 'arrowListItem',
  content: 'paragraph+',
  defining: true,

  parseHTML() {
    return [{ tag: 'li.arrow-list-item' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['li', mergeAttributes(HTMLAttributes, { class: 'arrow-list-item' }), 0]
  },

  addNodeView() {
    return () => {
      const li = document.createElement('li')
      li.className = 'arrow-list-item'

      const marker = document.createElement('span')
      marker.className = 'arrow-marker'
      marker.setAttribute('contenteditable', 'false')
      marker.setAttribute('aria-hidden', 'true')

      const content = document.createElement('div')
      content.className = 'arrow-content'

      li.appendChild(marker)
      li.appendChild(content)

      return { dom: li, contentDOM: content }
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
          console.log('[ArrowList] InputRule fired')
          const paraType          = this.editor.schema.nodes.paragraph
          const arrowListItemType = this.editor.schema.nodes.arrowListItem
          console.log('[ArrowList] InputRule — paragraph:', !!paraType, '| arrowListItem:', !!arrowListItemType)
          if (!paraType || !arrowListItemType) return

          const $from    = state.doc.resolve(range.from)
          const nodeFrom = $from.before($from.depth)
          const nodeTo   = $from.after($from.depth)

          const item      = arrowListItemType.create(null, paraType.create(null))
          const arrowList = this.type.create(null, [item])

          state.tr.replaceWith(nodeFrom, nodeTo, arrowList)
          // nodeFrom +1 (arrowList open) +1 (arrowListItem open) +1 (para open) = nodeFrom+3
          state.tr.setSelection(TextSelection.create(state.tr.doc, nodeFrom + 3))
          console.log('[ArrowList] InputRule — tr.doc after conversion:', JSON.stringify(state.tr.doc.toJSON()))
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
    return {
      Enter: () => {
        const { state, view } = this.editor
        const { $from, empty } = state.selection
        const firstChild = $from.parent.firstChild

        console.log('[ArrowList] Enter fired | parentType:', $from.parent.type.name)
        console.log('[ArrowList] depth check | d0:', $from.node(0).type.name, '| d1:', $from.node(1)?.type.name, '| d2:', $from.node(2)?.type.name, '| d3:', $from.node(3)?.type.name)

        const insideArrowListItem =
          empty &&
          $from.parent.type.name === 'paragraph' &&
          $from.node($from.depth - 1)?.type.name === 'arrowListItem' &&
          $from.node($from.depth - 2)?.type.name === this.name

        if (insideArrowListItem) {
          const marker = document.querySelector('.arrow-list .arrow-marker') as HTMLElement
          console.log('[ArrowList] marker offsetWidth BEFORE:', marker?.offsetWidth, '| marker offsetLeft:', marker?.offsetLeft)
          const result = this.editor.commands.splitListItem('arrowListItem')
          requestAnimationFrame(() => {
            const markerAfter = document.querySelector('.arrow-list .arrow-marker') as HTMLElement
            console.log('[ArrowList] marker offsetWidth AFTER:', markerAfter?.offsetWidth, '| marker offsetLeft:', markerAfter?.offsetLeft)
          })
          return result
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
