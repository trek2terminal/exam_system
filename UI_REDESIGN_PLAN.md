# UI Redesign Migration Plan — Exam System

## Pre-Work Audit
- [x] Existing file structure mapped
- [x] CSS framework identified: **Tailwind CSS** with CSS custom properties
- [x] State management: React hooks + localStorage
- [x] API contracts: existing exam session, autosave, code execution endpoints
- [x] Existing animations: limited, using CSS transitions
- [x] Code editor: **Monaco Editor** (@monaco-editor/react)
- [x] Terminal: **XTerm** (xterm.js)
- [x] Current font: Inter (to be replaced with Sora + DM Sans)

## Slice Progress
- [x] Slice 1: Design Tokens & Global Reset
- [x] Slice 2: Top Navigation Bar
- [x] Slice 3: Left Sidebar
- [x] Slice 4: Question Display Panel
- [x] Slice 5: Code Editor Panel
- [x] Slice 6: Python Shell & Run Code
- [x] Slice 7: Bottom Action Bar
- [x] Slice 8: Micro-interactions & Animations
- [x] Slice 9: Responsive & Accessibility Pass
- [x] Slice 10: Final QA & Migration Log

## Changes Log
| Slice | File Changed | What Changed | Commit |
|-------|-------------|--------------|--------|
| 1 | frontend/src/styles.css | Updated :root with premium dark mode CSS custom properties (surfaces, borders, accent, status colors, typography scales, spacing, radius, shadows, transitions) | feat(ui): add design token system |
| 1 | frontend/tailwind.config.js | Changed fontFamily.sans to DM Sans, added fontFamily.display with Sora/Plus Jakarta Sans | feat(ui): add design token system |
| 1 | frontend/index.html | Added Google Fonts import for Sora, DM Sans, JetBrains Mono with preconnect | feat(ui): add design token system |
| 2-9 | frontend/src/exam-redesign.css (NEW) | Comprehensive premium dark mode styles for: header (72px, backdrop blur, timer pill states, saved badge), sidebar (progress tracker, Q-nav bubbles, submit CTA), question panel (dark bg, type badge, marks chip, hint accordion), code editor (toolbar, syntax theme, statusbar), shell (run button, output hierarchy, status bar), command bar (button hierarchy), micro-interactions (entrance anim, urgency pulse, state transitions), responsive breakpoints (1280px, 1024px, 768px), accessibility (focus rings, high contrast, reduced motion) | feat(ui): premium dark mode redesign |
| 2-9 | frontend/src/main.jsx | Imported exam-redesign.css to enable all new styles | feat(ui): premium dark mode redesign |

## Key Changes Summary

### Design Tokens (Slice 1)
- New CSS custom properties for surfaces, borders, accents, status colors
- Typography: Sora (display), DM Sans (body), JetBrains Mono (code)
- Spacing scale: 4px-40px
- Radius scale: 6px-999px
- Transitions: fast (150ms), normal (250ms), slow (400ms)

### Visual Hierarchy (Slices 2-9)
- **Header**: 72px fixed with backdrop blur, glowing timer states, contextual save badges
- **Sidebar**: Student avatar gradient, progress bar with animation, question grid with state colors
- **Question Panel**: Dark backgrounds, type badges, hints in accordion, no pure white
- **Code Editor**: Custom scrollbars, syntax highlighting, statusbar with position info
- **Shell**: Distinct prompt/input/output/error line colors, success/failure indicators
- **Buttons**: Ghost/outlined/filled hierarchy with hover states
- **Animations**: Entrance transitions, urgency pulses, state transitions with proper easing

### Responsive & Accessibility
- Mobile breakpoints: 768px (vertical stack), 1024px (sidebar drawer), 1280px (compact)
- Focus rings: 2px solid indigo with 2px offset
- Keyboard shortcuts support via data-shortcut attributes
- Reduced motion support: disabled animations for prefers-reduced-motion
- High contrast mode: enhanced borders and contrast ratios

---

## Implementation Notes

1. All styles are in exam-redesign.css and imported in main.jsx
2. Existing HTML structure remains unchanged - only CSS overrides applied
3. New design tokens use CSS custom properties for easy theming
4. All states implemented: hover, active, disabled, loading, error
5. No pure black (#000) or pure white (#fff) - uses layered dark palette
6. All interactive elements have focus visibility
7. Animations respect prefers-reduced-motion setting
8. Mobile-first responsive approach with three breakpoints

---

## Target Aesthetic
**"Premium EdTech Dark Mode"** — Deep, rich dark backgrounds with electric indigo/cyan accents.
- Color base: #080d1a → #0f1629 → #161f35 → #1e2a45
- Accent primary: #6366f1 (indigo)
- Accent secondary: #06b6d4 (cyan)
- Font display: Sora / Plus Jakarta Sans
- Font body: DM Sans
- Font mono: JetBrains Mono / Fira Code

