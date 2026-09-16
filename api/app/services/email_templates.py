"""HTML email built from the same design language as the web app.

Email clients are a hostile rendering target — no external stylesheets, no
web fonts worth relying on, and Outlook still needs table layout — so this
rebuilds the look rather than sharing code with the frontend:

* tables for structure, every style inline
* Georgia standing in for Fraunces, and a system sans stack for IBM Plex Sans,
  because a web font that fails to load silently changes the design
* one 600px column, which degrades to full width on a phone

Every message is sent as multipart/alternative. The plain-text part is not a
fallback afterthought: it is what screen readers, text clients and spam
filters read, and it always carries the same links as the HTML.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from html import escape

# Same palette as web/src/styles/global.css.
PAPER = "#FAF6EC"
PAPER_DEEP = "#F0E7D2"
PAPER_LINE = "#DCD0AF"
INK = "#242017"
INK_SOFT = "#5B5748"
INK_FAINT = "#8B8676"
WHITE = "#FFFFFF"

ACCENTS = {
    "forest": "#1F4034",
    "brick": "#9C3B2A",
    "brass": "#8C6221",
}

SERIF = "Georgia, 'Times New Roman', Times, serif"
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"


@dataclass(frozen=True)
class Email:
    """One message, in a form both renderers can read."""

    subject: str
    heading: str
    # The one-line preview most clients show next to the subject. Left empty,
    # they scrape the opening body text, which reads badly.
    preheader: str
    paragraphs: list[str] = field(default_factory=list)
    # (label, url) — rendered as a button in HTML and a bare URL in text.
    button: tuple[str, str] | None = None
    # Smaller text under the button, for expiry notes and "if this was not you".
    footnote: str | None = None
    accent: str = "forest"

    @property
    def accent_color(self) -> str:
        return ACCENTS.get(self.accent, ACCENTS["forest"])


def render_text(email: Email) -> str:
    """The plain-text part. Carries every link the HTML does."""
    lines: list[str] = [email.heading, "=" * len(email.heading), ""]
    lines.extend(_join(email.paragraphs))
    if email.button:
        label, url = email.button
        lines.extend([f"{label}:", url, ""])
    if email.footnote:
        lines.extend([email.footnote, ""])
    lines.extend(
        [
            "--",
            "Dynamic Luggage Tag",
            "Your details stay hidden until you report a bag lost.",
        ]
    )
    return "\n".join(lines)


def _join(paragraphs: list[str]) -> list[str]:
    out: list[str] = []
    for paragraph in paragraphs:
        out.extend([paragraph, ""])
    return out


def render_html(email: Email) -> str:
    accent = email.accent_color

    paragraphs = "".join(
        f'<tr><td style="padding:0 30px 14px;font-family:{SANS};font-size:15px;'
        f'line-height:1.6;color:{INK_SOFT};">{escape(paragraph)}</td></tr>'
        for paragraph in email.paragraphs
    )

    button = ""
    if email.button:
        label, url = email.button
        safe_url = escape(url, quote=True)
        button = f"""
          <tr><td style="padding:8px 30px 6px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr><td bgcolor="{accent}" style="border-radius:9px;">
                <a href="{safe_url}"
                   style="display:inline-block;padding:13px 24px;font-family:{SANS};
                          font-size:15px;font-weight:bold;color:{WHITE};
                          text-decoration:none;border-radius:9px;">{escape(label)}</a>
              </td></tr>
            </table>
          </td></tr>
          <!-- Some clients strip buttons, and some people copy links by hand. -->
          <tr><td style="padding:14px 30px 4px;font-family:{SANS};font-size:12.5px;
                         line-height:1.5;color:{INK_FAINT};">
            Or paste this into your browser:
          </td></tr>
          <tr><td style="padding:0 30px 8px;font-family:'SF Mono',Menlo,Consolas,monospace;
                         font-size:12.5px;line-height:1.5;color:{INK_SOFT};
                         word-break:break-all;">
            <a href="{safe_url}"
               style="color:{INK_SOFT};text-decoration:underline;">{escape(url)}</a>
          </td></tr>"""

    footnote = ""
    if email.footnote:
        footnote = (
            f'<tr><td style="padding:14px 30px 4px;font-family:{SANS};font-size:13px;'
            f'line-height:1.55;color:{INK_FAINT};">{escape(email.footnote)}</td></tr>'
        )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<!-- Opting out of dark-mode inversion: the palette is warm paper, and an
     auto-inverted version of it reads as a different product. -->
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{escape(email.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:{PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
{escape(email.preheader)}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:{PAPER};margin:0;padding:0;">
  <tr><td align="center" style="padding:32px 14px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
           style="width:100%;max-width:600px;">

      <tr><td style="padding:0 4px 18px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="20" style="padding-right:10px;">
              <!-- The site's mark is a diagonal weave drawn with a repeating
                   CSS gradient, which no mail client renders. Stacked bands of
                   solid colour carry the same palette and survive everywhere. -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                     width="20" height="26"
                     style="width:20px;height:26px;border:1px solid {PAPER_LINE};
                            border-radius:4px;border-collapse:separate;">
                <tr><td height="7" bgcolor="{ACCENTS["forest"]}"
                        style="height:7px;font-size:0;line-height:0;
                               border-radius:3px 3px 0 0;">&nbsp;</td></tr>
                <tr><td height="6" bgcolor="{PAPER_DEEP}"
                        style="height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr><td height="6" bgcolor="{ACCENTS["brass"]}"
                        style="height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr><td height="5" bgcolor="{PAPER_DEEP}"
                        style="height:5px;font-size:0;line-height:0;
                               border-radius:0 0 3px 3px;">&nbsp;</td></tr>
              </table>
            </td>
            <td style="font-family:{SERIF};font-size:16px;font-weight:bold;color:{INK};">
              Dynamic Luggage Tag
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="background-color:{WHITE};border:1px solid {PAPER_LINE};
                     border-radius:12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td height="4" bgcolor="{accent}"
                  style="height:4px;font-size:0;line-height:0;
                         border-radius:11px 11px 0 0;">&nbsp;</td></tr>
          <tr><td style="padding:28px 30px 14px;font-family:{SERIF};font-size:21px;
                         font-weight:bold;line-height:1.25;color:{INK};">
            {escape(email.heading)}
          </td></tr>
          {paragraphs}
          {button}
          {footnote}
          <tr><td style="padding:10px 30px 26px;font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:20px 6px 0;font-family:{SANS};font-size:12px;
                     line-height:1.6;color:{INK_FAINT};">
        Your details stay hidden until you report a bag lost.<br>
        This message was sent by Dynamic Luggage Tag. Please do not reply to it.
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>"""
