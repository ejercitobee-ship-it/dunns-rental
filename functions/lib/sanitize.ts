// Server-side defense-in-depth strip for user-authored HTML (announcement
// bodies) before it is stored. The Workers runtime has no DOM, so this is a
// conservative regex pass that removes the constructs that let stored HTML run
// script. It is NOT a full sanitizer: the browser-side allowlist sanitizer in
// src/lib/sanitizeHtml.ts is the primary control at render time. This layer
// means that even a row written by a direct API call cannot carry a <script>
// tag or an inline event handler into the database.

const DANGEROUS_ELEMENTS = 'script|style|iframe|object|embed|link|meta|form|base';

export function stripDangerousHtml(html: string): string {
  if (!html) return html;
  return html
    // Paired dangerous elements and their contents, e.g. <script>...</script>.
    .replace(
      new RegExp(`<\\s*(${DANGEROUS_ELEMENTS})\\b[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>`, 'gi'),
      ''
    )
    // Any remaining/self-closing dangerous tags.
    .replace(new RegExp(`<\\s*/?\\s*(${DANGEROUS_ELEMENTS})\\b[^>]*>`, 'gi'), '')
    // Inline event handlers: onerror=, onclick=, etc. (quoted or bare).
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    // javascript:/vbscript:/data: URLs in href/src.
    .replace(/((?:href|src)\s*=\s*)(["']?)\s*(?:javascript|vbscript|data):[^"'>\s]*\2/gi, '$1$2#$2');
}
