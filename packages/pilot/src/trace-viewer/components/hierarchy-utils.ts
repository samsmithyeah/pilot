// ─── Types ───

export interface HierarchyNode {
  tagName: string
  attributes: Map<string, string>
  children: HierarchyNode[]
  depth: number
}

export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

// ─── XML Parser ───

export function parseHierarchyXml(xml: string): HierarchyNode[] {
  const roots: HierarchyNode[] = []
  const stack: HierarchyNode[] = []

  const tagRe = /<(\/?)([a-zA-Z_][\w.]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g
  let match: RegExpExecArray | null

  while ((match = tagRe.exec(xml)) !== null) {
    const isClosing = match[1] === '/'
    const tagName = match[2]
    const attrsStr = match[3]
    const isSelfClosing = match[4] === '/'

    if (isClosing) {
      if (stack.length > 0) stack.pop()
      continue
    }

    const attributes = new Map<string, string>()
    const attrRe = /([\w:.-]+)="([^"]*)"/g
    let attrMatch: RegExpExecArray | null
    while ((attrMatch = attrRe.exec(attrsStr)) !== null) {
      attributes.set(attrMatch[1], attrMatch[2])
    }

    const node: HierarchyNode = {
      tagName,
      attributes,
      children: [],
      depth: stack.length,
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node)
    } else {
      roots.push(node)
    }

    if (!isSelfClosing) {
      stack.push(node)
    }
  }

  return roots
}

// ─── Bounds Parser ───

export function parseBounds(boundsStr: string): Bounds | null {
  const match = boundsStr.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)
  if (!match) return null
  return {
    left: parseInt(match[1], 10),
    top: parseInt(match[2], 10),
    right: parseInt(match[3], 10),
    bottom: parseInt(match[4], 10),
  }
}

// ─── Selector Generator ───

export function generateSelector(node: HierarchyNode): string {
  // Android: content-desc, iOS: label (when used as accessibility description)
  const contentDesc = node.attributes.get('content-desc')
  if (contentDesc) return `contentDesc("${contentDesc}")`

  // Android: resource-id, iOS: identifier
  const resourceId = node.attributes.get('resource-id')
    ?? (node.attributes.get('identifier') || undefined)
  if (resourceId) return `id("${resourceId}")`

  // Android: text, iOS: label (when used as display text)
  const text = node.attributes.get('text')
    ?? (node.attributes.get('label') || undefined)
  if (text) return `text("${text}")`

  const className = node.attributes.get('class')
    ?? node.attributes.get('type')
    ?? node.tagName
  return `className("${className}")`
}
