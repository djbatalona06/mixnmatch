# 04 — UI / UX Brief

**Feel:** dark luxury, minimal, music-y. Near-black surfaces, one warm amber accent. Updated for the installable app — see [10-spec-app.md](10-spec-app.md).

## Tokens (all in `app/tailwind.config.js`)
| Token | Value | Use |
|---|---|---|
| `bg` | `#0a0a0a` | Page background |
| `surface` / `raised` | `#141414` / `#1a1a1a` | Cards, inputs |
| `line` | `#262626` | Lines |
| `fg` / `muted` | `#f5f5f5` / `#a3a3a3` | Text |
| `accent` | `#f59e0b` (amber) | The *only* bright colour: main buttons, progress, selection, focus |
| `ok` / `warn` / `bad` | `#10b981` / `#f59e0b` / `#f87171` | Matched / Need a look / Not found |
| Service colours | `app/src/lib/platforms.ts` | Small dots only |

Font: **Inter**, bundled with the app (works offline, no outside font server).
Shapes: cards `rounded-xl`, buttons and pills `rounded-full`.

## Rules
- One primary (amber) button per screen.
- Big square cover art for playlists; selected = amber border + check.
- Every song result has a word *and* a colour (never colour alone).
- Plain words: "Need a look", not "LOW_CONFIDENCE".
- Phones: bottom tab bar, safe areas (notch / home bar) respected, taps at least 40–44 px, no double-tap zoom.
- Works at phone width (375 px) with no sideways scrolling — checked by the smoke test.
- Keyboard: tiles and cover cards work with Tab + Space/Enter; visible amber focus ring.
- No inline scripts in HTML (the security policy blocks them); `index.html` holds only HTML.

## Components (`app/src/components/`)
`Button` / `buttonClass` (primary, default, ghost, danger; small, normal, big), `Card`, `Pill`, `Notice`, `PlatformDot`, `Spinner`, `PageTitle`, `CoverCard` (playlist), `Dialog` (native `<dialog>`: song peek, fix a song), `InstallCard` / `InstallBanner`, and the frame in `chrome.tsx` (header, tabs, offline bar, toasts).
