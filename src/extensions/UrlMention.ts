import { Node, mergeAttributes } from '@tiptap/core'
import { open } from '@tauri-apps/plugin-shell'
import { invoke } from '@tauri-apps/api/core'

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function makeLinkIcon(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 12 12')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.flexShrink = '0'
  // Lucide "link" icon scaled from 24→12
  svg.innerHTML = `
    <path d="M5 6.5a2.5 2.5 0 0 0 3.77.27l1.5-1.5a2.5 2.5 0 0 0-3.535-3.535l-.86.855" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M7 5.5a2.5 2.5 0 0 0-3.77-.27l-1.5 1.5a2.5 2.5 0 0 0 3.535 3.535l.855-.855" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  `
  return svg
}

export const UrlMention = Node.create({
  name: 'urlMention',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: el => el.getAttribute('data-url') ?? '',
        renderHTML: attrs => ({ 'data-url': attrs.url }),
      },
      title: {
        default: '',
        parseHTML: el => el.getAttribute('data-title') ?? '',
        renderHTML: attrs => ({ 'data-title': attrs.title }),
      },
      favicon: {
        default: '',
        parseHTML: el => el.getAttribute('data-favicon') ?? '',
        renderHTML: attrs => ({ 'data-favicon': attrs.favicon }),
      },
      loading: {
        default: true,
        parseHTML: el => el.getAttribute('data-loading') !== 'false',
        renderHTML: attrs => ({ 'data-loading': String(attrs.loading) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-url-mention]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-url-mention': '' })]
  },

  addNodeView() {
    return ({ node: initialNode, getPos, editor }: any) => {
      let currentNode = initialNode

      const span = document.createElement('span')
      span.className = 'url-mention-chip'
      span.setAttribute('contenteditable', 'false')

      const placeholder = document.createElement('span')
      placeholder.className = 'url-mention-placeholder'

      const img = document.createElement('img')
      img.className = 'url-mention-favicon'
      img.width = 12
      img.height = 12

      const linkIcon = makeLinkIcon()

      const titleEl = document.createElement('span')
      titleEl.className = 'url-mention-title'

      span.appendChild(placeholder)
      span.appendChild(img)
      span.appendChild(linkIcon)
      span.appendChild(titleEl)

      function sync(n: typeof initialNode) {
        const loading = n.attrs.loading as boolean
        placeholder.style.display = loading ? '' : 'none'
        titleEl.style.display = loading ? 'none' : ''
        if (!loading) {
          const hasFavicon = !!n.attrs.favicon
          img.style.display = hasFavicon ? '' : 'none'
          linkIcon.style.display = hasFavicon ? 'none' : ''
          if (hasFavicon) img.src = n.attrs.favicon
          titleEl.textContent = n.attrs.title || n.attrs.url || ''
        } else {
          img.style.display = 'none'
          linkIcon.style.display = 'none'
        }
      }

      sync(initialNode)

      if (initialNode.attrs.loading) {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        )
        setTimeout(() => {
          Promise.race([
            invoke<{ title: string; favicon: string }>('fetch_url_metadata', { url: initialNode.attrs.url }),
            timeout,
          ])
            .then(result => {
              const pos = typeof getPos === 'function' ? getPos() : undefined
              if (pos == null) return
              editor.view.dispatch(
                editor.view.state.tr.setNodeMarkup(pos, null, {
                  ...currentNode.attrs,
                  loading: false,
                  title: result.title,
                  favicon: result.favicon,
                })
              )
            })
            .catch(() => {
              const pos = typeof getPos === 'function' ? getPos() : undefined
              if (pos == null) return
              editor.view.dispatch(
                editor.view.state.tr.setNodeMarkup(pos, null, {
                  ...currentNode.attrs,
                  loading: false,
                  title: extractDomain(initialNode.attrs.url),
                  favicon: '',
                })
              )
            })
        }, 0)
      }

      span.addEventListener('click', () => {
        if (!currentNode.attrs.loading && currentNode.attrs.url) {
          open(currentNode.attrs.url)
        }
      })

      return {
        dom: span,
        update(updatedNode: any) {
          if (updatedNode.type !== currentNode.type) return false
          currentNode = updatedNode
          sync(updatedNode)
          return true
        },
      }
    }
  },
})
