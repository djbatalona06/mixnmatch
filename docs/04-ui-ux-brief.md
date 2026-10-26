# 04 — UI / UX Brief

**Feel:** dark luxury, minimal, music-y. Near-black surfaces, one warm amber accent. Updated for the installable app — see [10-spec-app.md](10-spec-app.md).

## Tokens (values in `app/src/index.css` as CSS variables, names in `app/tailwind.config.js`)
| Token | Value | Use |
|---|---|---|
| `bg` | `#0b0a09` | Page background |
| `surface` / `raised` | `#141311` / `#1c1a18` | Cards, inputs |
| `line` / `line-strong` | `#292623` / `#4e4943` | Lines / hovered lines |
| `fg` / `muted` | `#f5f3f0` / `#a8a29a` | Text |
| `accent` (`hover`, `deep`) | `#e3a047` (`#ecb562`, `#a86224`) | The *only* bright colour: main buttons, progress, selection, focus. Kept under 80% saturation so it looks warm, not neon |
| `ok` / `warn` / `bad` | `#46be8c` / accent / `#ef7b72` | Matched / Need a look / Not found |
| Service colours | `app/src/lib/platforms.ts` | Small dots only |

Font: **Geist**, bundled with the app (works offline, no outside font server). Headings are semibold with tight tracking; body text lines stay under 65 characters.
Shapes: one corner system. Cards, inputs and dialogs are `rounded-xl` (16 px), big panels `rounded-2xl` (24 px), buttons and pills `rounded-full`.
Shadows are tinted to the background (`shadow-soft`, `shadow-lift`), never glowing. Motion uses one easing curve (`cubic-bezier(0.16, 1, 0.3, 1)`), only moves `transform` and `opacity`, and stops when the phone asks for reduced motion.

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
`Button` / `buttonClass` (primary, default, ghost, danger; small, normal, big), `Card`, `Pill`, `Notice`, `PlatformDot`, `Spinner`, `Skeleton` (loading), `EmptyState` (nothing here yet), `PageTitle`, `CoverCard` (playlist), `Dialog` (native `<dialog>`: song peek, fix a song), `InstallCard` / `InstallBanner`, and the frame in `chrome.tsx` (header, tabs, offline bar, toasts).
