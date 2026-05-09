import { Node, mergeAttributes } from '@tiptap/core'
import { TextSelection, Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const ArrowList = Node.create({
  name: 'arrowList',
  group: 'block',
  content: 'listItem+',

  parseHTML() {
    return [{ tag: 'ul[data-type="arrowList"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['ul', mergeAttributes(HTMLAttributes, { 'data-type': 'arrowList', class: 'arrow-list' }), 0]
  },

  addProseMirrorPlugins() {
    const arrowListName = this.name
    const listItemName  = 'listItem'
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
                if (index === 0) {
                  console.log('[ArrowList] decoration | skipping first listItem at absPos:', absPos)
                  return
                }
                console.log('[ArrowList] decoration | adding continuation to listItem index:', index, 'absPos:', absPos)
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
      // Trigger: Enter on a paragraph whose first inline child is an arrow atom.
      // Converts the paragraph to arrowList > listItem > paragraph, places the
      // cursor at the split point, then calls splitListItem so TipTap's native
      // command handles the actual split and cursor placement.
      Enter: () => {
        const { state, view } = this.editor
        const { $from, empty } = state.selection
        const firstChild = $from.parent.firstChild

        // Logging-only branch: capture computed styles on the first li before and after
        // Enter when we're already inside an arrowList listItem paragraph.
        const insideArrowListItem =
          empty &&
          $from.parent.type.name === 'paragraph' &&
          $from.node($from.depth - 1)?.type.name === 'listItem' &&
          $from.node($from.depth - 2)?.type.name === this.name

        if (insideArrowListItem) {
          const firstLi = this.editor.view.dom.querySelector('ul.arrow-list li:first-child')
          if (firstLi) {
            const cs = window.getComputedStyle(firstLi)
            const beforeWidth = window.getComputedStyle(firstLi, '::before').width
            const firstLiText = firstLi.querySelector('p') || firstLi.firstElementChild
            console.log('[ArrowList] BEFORE Enter | li margin:', cs.margin, '| padding:', cs.padding, '| gap:', cs.gap, '| width:', cs.width)
            console.log('[ArrowList] BEFORE Enter | li offsetLeft:', (firstLi as HTMLElement).offsetLeft, '| offsetWidth:', (firstLi as HTMLElement).offsetWidth)
            console.log('[ArrowList] BEFORE Enter | ::before width:', beforeWidth, '| textNode offsetLeft:', (firstLiText as HTMLElement)?.offsetLeft)
            Array.from(firstLi.children).forEach((child, i) => {
              const ccs = window.getComputedStyle(child)
              console.log(`[ArrowList] BEFORE Enter | li child[${i}] tag:${child.tagName} margin:${ccs.margin} padding:${ccs.padding} width:${ccs.width} offsetLeft:${(child as HTMLElement).offsetLeft}`)
            })
          }
          requestAnimationFrame(() => {
            const firstLiAfter = this.editor.view.dom.querySelector('ul.arrow-list li:first-child')
            if (firstLiAfter) {
              const cs = window.getComputedStyle(firstLiAfter)
              const beforeWidth = window.getComputedStyle(firstLiAfter, '::before').width
              const firstLiText = firstLiAfter.querySelector('p') || firstLiAfter.firstElementChild
              console.log('[ArrowList] AFTER Enter | li margin:', cs.margin, '| padding:', cs.padding, '| gap:', cs.gap, '| width:', cs.width)
              console.log('[ArrowList] AFTER Enter | li offsetLeft:', (firstLiAfter as HTMLElement).offsetLeft, '| offsetWidth:', (firstLiAfter as HTMLElement).offsetWidth)
              console.log('[ArrowList] AFTER Enter | ::before width:', beforeWidth, '| textNode offsetLeft:', (firstLiText as HTMLElement)?.offsetLeft)
              Array.from(firstLiAfter.children).forEach((child, i) => {
                const ccs = window.getComputedStyle(child)
                console.log(`[ArrowList] AFTER Enter | li child[${i}] tag:${child.tagName} margin:${ccs.margin} padding:${ccs.padding} width:${ccs.width} offsetLeft:${(child as HTMLElement).offsetLeft}`)
              })
            }
          })
          return false  // let native splitListItem handle the actual split
        }

        if (!empty || $from.parent.type.name !== 'paragraph' || firstChild?.type.name !== 'arrow' || firstChild?.attrs.direction !== 'right') {
          return false
        }

        const paraType     = this.editor.schema.nodes.paragraph
        const listItemType = this.editor.schema.nodes.listItem
        if (!paraType || !listItemType) return false

        const arrowSize = firstChild.nodeSize
        const splitAt   = Math.max($from.parentOffset, arrowSize)

        // Build arrowList > listItem > paragraph(full content minus arrow atom)
        const fullContent = $from.parent.content.cut(arrowSize)
        const para        = paraType.create(null, fullContent)
        const item        = listItemType.create(null, para)
        const arrowList   = this.type.create(null, item)

        const nodeFrom = $from.before()
        const nodeTo   = $from.after()

        // Cursor inside the new paragraph at the original split offset.
        // +3 = arrowList open + listItem open + paragraph open
        const splitPoint = nodeFrom + 3 + (splitAt - arrowSize)

        const firstLi = document.querySelector('.arrow-list li:first-child')
        const firstLiText = firstLi?.querySelector('p') || firstLi?.firstElementChild
        const beforeWidthPre = firstLi ? window.getComputedStyle(firstLi, '::before').width : 'n/a'
        console.log('[ArrowList] BEFORE Enter | firstLi offsetLeft:', firstLi?.offsetLeft, '| textNode offsetLeft:', (firstLiText as HTMLElement)?.offsetLeft, '| firstLi width:', firstLi?.getBoundingClientRect().width)
        console.log('[ArrowList] BEFORE Enter | ::before width:', beforeWidthPre)

        const tr = state.tr.replaceWith(nodeFrom, nodeTo, arrowList)
        tr.setSelection(TextSelection.create(tr.doc, splitPoint))
        tr.scrollIntoView()
        view.dispatch(tr)

        requestAnimationFrame(() => {
          const firstLiAfter = document.querySelector('.arrow-list li:first-child')
          const firstLiTextAfter = firstLiAfter?.querySelector('p') || firstLiAfter?.firstElementChild
          const beforeWidthPost = firstLiAfter ? window.getComputedStyle(firstLiAfter, '::before').width : 'n/a'
          console.log('[ArrowList] AFTER Enter | firstLi offsetLeft:', firstLiAfter?.offsetLeft, '| textNode offsetLeft:', (firstLiTextAfter as HTMLElement)?.offsetLeft, '| firstLi width:', firstLiAfter?.getBoundingClientRect().width)
          console.log('[ArrowList] AFTER Enter | ::before width:', beforeWidthPost)
        })

        // Cursor is now inside a normal paragraph — splitListItem works correctly here.
        this.editor.commands.splitListItem('listItem')
        return true
      },
    }
  },
})
