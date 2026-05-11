import { Node, mergeAttributes, InputRule } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { ResolvedPos } from '@tiptap/pm/model'

const ChevronListItem = Node.create({
  name: 'chevronListItem',
  content: 'paragraph+',

  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: el => parseInt(el.getAttribute('data-level') ?? '1', 10),
        renderHTML: attrs => ({ 'data-level': attrs.level }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'li.chevron-list-item' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['li', mergeAttributes(HTMLAttributes, { class: 'chevron-list-item' }), 0]
  },

  addNodeView() {
    return ({ node }) => {
      const li = document.createElement('li')
      li.className = 'chevron-list-item'
      li.setAttribute('data-level', String(node.attrs.level ?? 1))

      const marker = document.createElement('span')
      marker.className = 'chevron-marker'
      marker.setAttribute('contenteditable', 'false')
      marker.setAttribute('aria-hidden', 'true')

      const content = document.createElement('div')
      content.className = 'chevron-content'

      li.appendChild(marker)
      li.appendChild(content)

      return {
        dom: li,
        contentDOM: content,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false
          li.setAttribute('data-level', String(updatedNode.attrs.level ?? 1))
          return true
        },
      }
    }
  },
})

export const ChevronList = Node.create({
  name: 'chevronList',
  group: 'block',
  content: 'chevronListItem+',

  parseHTML() {
    return [{ tag: 'ul[data-type="chevronList"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['ul', mergeAttributes(HTMLAttributes, { 'data-type': 'chevronList', class: 'chevron-list' }), 0]
  },

  addExtensions() {
    return [ChevronListItem]
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^> $/,
        handler: ({ state, range }) => {
          const paraType            = this.editor.schema.nodes.paragraph
          const chevronListItemType = this.editor.schema.nodes.chevronListItem
          if (!paraType || !chevronListItemType) return

          const $from    = state.doc.resolve(range.from)
          const nodeFrom = $from.before($from.depth)
          const nodeTo   = $from.after($from.depth)

          const item        = chevronListItemType.create({ level: 1 }, paraType.create(null))
          const chevronList = this.type.create(null, [item])

          state.tr.replaceWith(nodeFrom, nodeTo, chevronList)
          // nodeFrom +1 (chevronList open) +1 (chevronListItem open) +1 (para open) = nodeFrom+3
          state.tr.setSelection(TextSelection.create(state.tr.doc, nodeFrom + 3))
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    const inChevronListItem = ($from: ResolvedPos) =>
      $from.parent.type.name === 'paragraph' &&
      $from.node($from.depth - 1)?.type.name === 'chevronListItem' &&
      $from.node($from.depth - 2)?.type.name === this.name

    return {
      Tab: () => {
        const { state, view } = this.editor
        const { $from } = state.selection
        if (!inChevronListItem($from)) return false

        const item    = $from.node($from.depth - 1)
        const itemPos = $from.before($from.depth - 1)
        const level   = (item.attrs.level as number) ?? 1

        if (level >= 3) return true  // block browser default, no-op at ceiling
        view.dispatch(state.tr.setNodeMarkup(itemPos, null, { ...item.attrs, level: level + 1 }))
        return true
      },

      'Shift-Tab': () => {
        const { state, view } = this.editor
        const { $from } = state.selection
        if (!inChevronListItem($from)) return false

        const item    = $from.node($from.depth - 1)
        const itemPos = $from.before($from.depth - 1)
        const level   = (item.attrs.level as number) ?? 1

        if (level <= 1) return true  // block browser default, no-op at floor
        view.dispatch(state.tr.setNodeMarkup(itemPos, null, { ...item.attrs, level: level - 1 }))
        return true
      },

      Backspace: () => {
        const { state, view } = this.editor
        const { $from, empty } = state.selection
        // Guard: empty selection, cursor at start of the paragraph inside a chevronListItem
        if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== 0) return false
        const item = $from.node($from.depth - 1)
        if (item?.type.name !== 'chevronListItem') return false

        const level   = (item.attrs.level as number) ?? 1
        const isEmpty = $from.parent.content.size === 0

        // Non-empty item: level > 1 → decrease level; level 1 → let ProseMirror join naturally
        if (!isEmpty) {
          if (level > 1) {
            const itemPos = $from.before($from.depth - 1)
            const tr = state.tr.setNodeMarkup(itemPos, null, { ...item.attrs, level: level - 1 })
            tr.setSelection(TextSelection.create(tr.doc, $from.end()))
            view.dispatch(tr)
            return true
          }
          return false
        }

        // Empty item: delete it entirely
        const listNode    = $from.node($from.depth - 2)
        const listFrom    = $from.before($from.depth - 2)
        const listTo      = listFrom + listNode.nodeSize
        const itemFrom    = $from.before($from.depth - 1)
        const itemTo      = itemFrom + item.nodeSize
        const isFirstItem = itemFrom === listFrom + 1

        const tr = state.tr

        if (level > 1 && !isFirstItem) {
          // Has a preceding sibling: delete item, cursor to end of preceding item
          tr.delete(itemFrom, itemTo)
          tr.setSelection(TextSelection.near(tr.doc.resolve(itemFrom - 1), -1))
        } else if (listNode.childCount === 1) {
          // Last item in list: delete whole list, cursor to end of preceding block
          tr.delete(listFrom, listTo)
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, listFrom - 1)), -1))
        } else {
          // Level 1 (or level 2/3 first item): delete item, cursor to end of preceding block
          tr.delete(itemFrom, itemTo)
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, listFrom - 1)), -1))
        }

        tr.scrollIntoView()
        view.dispatch(tr)
        return true
      },

      Enter: () => {
        const { state, view } = this.editor
        const { $from, empty } = state.selection

        if (!empty || !inChevronListItem($from)) return false

        const item         = $from.node($from.depth - 1)
        const currentLevel = (item.attrs.level as number) ?? 1
        const nextLevel    = currentLevel === 1 ? 2 : currentLevel

        // Double-Enter on empty item: exit to paragraph
        if ($from.parent.content.size === 0) {
          return this.editor.commands.liftListItem('chevronListItem')
        }

        const paraType            = this.editor.schema.nodes.paragraph
        const chevronListItemType = this.editor.schema.nodes.chevronListItem
        if (!paraType || !chevronListItemType) return false

        const itemFrom      = $from.before($from.depth - 1)
        const itemTo        = $from.after($from.depth - 1)
        const beforeContent = $from.parent.content.cut(0, $from.parentOffset)
        const afterContent  = $from.parent.content.cut($from.parentOffset)

        const item1 = chevronListItemType.create({ level: currentLevel }, paraType.create(null, beforeContent))
        const item2 = chevronListItemType.create({ level: nextLevel }, paraType.create(null, afterContent))

        const tr = state.tr.replaceWith(itemFrom, itemTo, [item1, item2])
        // itemFrom + item1.nodeSize = item2 open; +1 para2 open; +1 = para2 content start
        tr.setSelection(TextSelection.create(tr.doc, itemFrom + item1.nodeSize + 2))
        tr.scrollIntoView()
        view.dispatch(tr)
        return true
      },
    }
  },
})
