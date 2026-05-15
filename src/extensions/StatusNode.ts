import { Node, mergeAttributes, InputRule } from '@tiptap/core'
import { NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

type Status = 'TODO' | 'INPROGRESS' | 'DONE'

const CYCLE: Record<Status, Status> = {
  TODO: 'INPROGRESS',
  INPROGRESS: 'DONE',
  DONE: 'TODO',
}

export const StatusNode = Node.create({
  name: 'statusNode',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      status: {
        default: 'TODO' as Status,
        parseHTML: el => (el.getAttribute('data-status') as Status) ?? 'TODO',
        renderHTML: attrs => ({ 'data-status': attrs.status }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-status]' }]
  },

  renderHTML({ node }) {
    return ['span', mergeAttributes({ 'data-status': node.attrs.status }), node.attrs.status]
  },

  addNodeView() {
    return ({ node: initialNode }: any) => {
      let currentNode = initialNode

      const span = document.createElement('span')
      span.setAttribute('contenteditable', 'false')
      span.setAttribute('data-status', initialNode.attrs.status)
      span.style.userSelect = 'none'
      span.style.webkitUserSelect = 'none'
      span.textContent = initialNode.attrs.status as string

      return {
        dom: span,
        update(updatedNode: any) {
          if (updatedNode.type !== currentNode.type) return false
          currentNode = updatedNode
          span.setAttribute('data-status', updatedNode.attrs.status)
          span.textContent = updatedNode.attrs.status as string
          return true
        },
      }
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: /(TODO|INPROGRESS|DONE) $/,
        handler: ({ state, range, match }) => {
          const status = match[1] as Status
          state.tr.replaceWith(range.from, range.to, this.type.create({ status }))
          state.tr.insertText(' ', range.from + 1)
          state.tr.setSelection(TextSelection.create(state.tr.doc, range.from + 2))
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    const name = this.name
    return [
      new Plugin({
        props: {
          handleClick(view, pos) {
            const node = view.state.doc.nodeAt(pos)
            if (node?.type.name !== name) return false
            const next = CYCLE[node.attrs.status as Status] ?? 'TODO'
            view.dispatch(view.state.tr.setNodeMarkup(pos, null, { status: next }))
            return true
          },
          decorations(state) {
            const { doc } = state
            const decos: Decoration[] = []
            doc.forEach((node, offset) => {
              if (node.type.name !== 'paragraph' || node.firstChild?.type.name !== name) return

              decos.push(Decoration.node(offset, offset + node.nodeSize, { style: 'padding-left: 24px' }))

              const status = node.firstChild.attrs.status as Status
              if (status === 'TODO') return

              // Compute text range: after paragraph open (1) + statusNode (1) + optional space (1)
              const secondChild = node.childCount > 1 ? node.child(1) : null
              const spaceSize = secondChild?.isText && secondChild.text?.[0] === ' ' ? 1 : 0
              const textFrom = offset + 1 + 1 + spaceSize  // para open + statusNode + space
              const textTo = offset + node.nodeSize - 1     // before para close

              if (textFrom >= textTo) return

              const style = status === 'INPROGRESS' ? 'font-weight: bold' : 'text-decoration: line-through'
              decos.push(Decoration.inline(textFrom, textTo, { style }))
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
        if (!empty) return false

        const para = $from.parent
        if (para.type.name !== 'paragraph') return false
        if (para.firstChild?.type.name !== this.name) return false

        const paraFrom = $from.before($from.depth)
        const paraTo = $from.after($from.depth)
        const paraType = state.schema.nodes.paragraph
        const statusNodeType = state.schema.nodes[this.name]

        // "Empty" = only statusNode (size 1) + optional single space (size 1)
        if (para.content.size <= 2) {
          const tr = state.tr
          tr.replaceWith(paraFrom, paraTo, paraType.create())
          tr.setSelection(TextSelection.create(tr.doc, paraFrom + 1))
          tr.scrollIntoView()
          view.dispatch(tr)
          return true
        }

        // Split at cursor, prepend fresh TODO node to second paragraph
        const beforeContent = para.content.cut(0, $from.parentOffset)
        const afterContent = para.content.cut($from.parentOffset)

        const newStatusNode = statusNodeType.create({ status: 'TODO' })
        const spaceText = state.schema.text(' ')
        const newParaContent = afterContent.size > 0
          ? Fragment.from([newStatusNode, spaceText]).append(afterContent)
          : Fragment.from([newStatusNode, spaceText])

        const currentPara = paraType.create(null, beforeContent)
        const newPara = paraType.create(null, newParaContent)

        const tr = state.tr
        tr.replaceWith(paraFrom, paraTo, [currentPara, newPara])
        // Cursor after statusNode (size 1) + space (size 1) inside newPara
        tr.setSelection(TextSelection.create(tr.doc, paraFrom + currentPara.nodeSize + 3))
        tr.scrollIntoView()
        view.dispatch(tr)
        return true
      },

      Backspace: () => {
        const { state, view } = this.editor
        const { selection } = state
        if (!selection.empty) return false

        const nodeBefore = selection.$anchor.nodeBefore
        if (nodeBefore?.type.name !== this.name) return false

        const nodePos = selection.$anchor.pos - nodeBefore.nodeSize
        view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, nodePos)))
        return true
      },
    }
  },
})
