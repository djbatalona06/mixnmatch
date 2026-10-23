# 04 — UI / UX Brief

**Feel:** dark, minimal, music-y. Like Spotify meets Linear. Calm background, one loud colour.

## Tokens (all in `public/css/styles.css` → `:root`)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#0b0b0f` | Page background |
| `--surface` / `--surface-2` | `#15151c` / `#1d1d27` | Cards, inputs |
| `--border` | `#2a2a36` | Lines |
| `--text` / `--muted` | `#f4f4f7` / `#9a9aab` | Text |
| `--accent` | `#c8f04a` (lime) | The *only* bright colour: main buttons, progress, selection |
| `--ok` / `--warn` / `--bad` | green / amber / red | Matched / Need a look / Not found |
| Service colours | `--spotify`, `--tidal`, `--deezer`, `--youtube`, `--file` | Small dots only, via `.c-<service>` classes |

Fonts: **Space Grotesk** (headings), **Inter** (text), from Google Fonts.

## Rules
- One primary (lime) button per screen.
- Big square cover art for playlists; selected = lime border + check.
- Every song result has a word *and* a colour (never colour alone).
- Plain words: "Need a look", not "LOW_CONFIDENCE".
- Works at phone width (375 px) with no sideways scrolling — checked by the smoke test.
- Keyboard: tiles and cover cards work with Tab + Space/Enter; visible lime focus ring.
- Respects "reduce motion".
- No inline styles or scripts in HTML (the security policy blocks them).

## Components
`.btn` (+ `-primary`, `-ghost`, `-danger`, `-small`, `-big`), `.card`, `.tile` (wizard choice), `.cover-card` (playlist), `.stepper`, `.progress`, `.stat`, `.pill`, `.tabs`, `.notice`, `.toast`, `<dialog>` (song peek).
