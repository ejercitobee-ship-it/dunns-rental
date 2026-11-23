// Shared HTML sanitizer for any user-authored rich text that the app renders
// with dangerouslySetInnerHTML (property notes, announcements). Allowlist based:
// unknown tags are dropped, unknown attributes are stripped, and javascript:
// URLs are removed. This runs in the browser (DOMParser), which is where the
// rendering happens, so it is the primary XSS control. The server also strips
// obviously dangerous constructs on write as defense in depth
// (see functions/lib/sanitize.ts).

const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'sub', 'sup',
  'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]);

const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'class', 'style', 'colspan', 'rowspan']);

// Attribute values that start with these schemes are never allowed.
const DANGEROUS_URL = /^\s*(javascript|data|vbscript):/i;
const URL_ATTRS = new Set(['href', 'src']);

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (!ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
          el.remove();
          continue;
        }
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          const isUrlAttr = URL_ATTRS.has(name);
          if (
            !ALLOWED_ATTRS.has(name) ||
            name.startsWith('on') ||
            (isUrlAttr && DANGEROUS_URL.test(attr.value))
          ) {
            el.removeAttribute(attr.name);
          }
        }
        walk(el);
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
