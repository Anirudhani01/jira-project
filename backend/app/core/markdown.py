"""Server-side Markdown rendering for comment bodies (plan M8, §4.5): "Markdown rendered
without raw HTML and with URL protocol allowlist." Two independent steps, never one:

1. ``markdown`` (Python-Markdown) turns the body into HTML. Per the CommonMark/Markdown
   spec it passes raw HTML blocks/inline HTML in the source straight through -- it is NOT
   itself a sanitizer, and must never be treated as one.
2. ``nh3`` (a maintained Rust-backed HTML sanitizer) then strips everything not on an
   explicit allowlist: disallowed tags (``<script>``, ``<img>``, ``<iframe>``, ...),
   disallowed attributes (``onerror``, ``onclick``, ...), and disallowed URL schemes
   (``javascript:``, ``data:``, ...) on the one attribute (``href``) that carries a URL.

Only the output of step 2 is ever returned; the raw comment body is stored and returned
separately (schemas.CommentResponse.body vs .body_html) and is never rendered as HTML by
the backend or trusted as HTML by the frontend.

No images: embedding is an easy SSRF/tracking vector and attachments are out of MVP scope
(plan §1.5), so ``img`` is simply not on the allowed-tags list.
"""

import markdown
import nh3

_ALLOWED_TAGS = frozenset(
    {
        "p",
        "br",
        "strong",
        "em",
        "del",
        "code",
        "pre",
        "blockquote",
        "ul",
        "ol",
        "li",
        "a",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hr",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
    }
)
_ALLOWED_ATTRIBUTES = {"a": {"href", "title"}}
_ALLOWED_URL_SCHEMES = frozenset({"http", "https", "mailto"})
_MARKDOWN_EXTENSIONS = ("fenced_code", "tables", "sane_lists")


def render_comment_body(body: str) -> str:
    """Raw Markdown -> sanitized HTML. Idempotent and side-effect free; never persisted,
    computed fresh on every read (the ``comments`` table has no HTML column -- plan §2.3's
    documented schema is ``body`` only)."""
    html = markdown.markdown(body, extensions=list(_MARKDOWN_EXTENSIONS))
    return nh3.clean(
        html,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRIBUTES,
        url_schemes=_ALLOWED_URL_SCHEMES,
        link_rel="noopener noreferrer nofollow",
    )
