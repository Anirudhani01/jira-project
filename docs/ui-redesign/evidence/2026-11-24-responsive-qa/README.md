# Responsive and visual QA — 2026-11-24

Evidence that every page works in all three themes at phone, tablet and desktop width.

## Result

| | |
|---|---|
| Pages checked | 27 (4 public, 23 signed in) |
| Themes | light, paper, dark |
| Widths | phone 375 px, tablet 768 px, desktop 1440 px |
| Combinations | 243 |
| Horizontal page overflow | 0 |
| Serious or critical accessibility (axe) violations | 0 |
| Pages that failed to load / wrong theme applied | 0 / 0 |

Pages: login, sign up, forgot password, not found, org dashboard, org settings, members, audit log, admin overview / general / members / invitations / catalogs / audit / authentication activity / workflow / notifications / email, project overview, issue list, Scrum board, Kanban board, backlog, issue detail, create project, create organization, account.

Data: the local demo seed (`make seed-demo`): org `demo`, projects MOBILE (Scrum) and SHOP (Kanban). Browser: Chromium via Playwright; phone runs use touch emulation.

## What the first sweep found, and the fixes

| Finding | Where | Fix |
|---|---|---|
| Page 29 px wider than the screen | Issue list, tablet | Table shells are `relative`, so the visually hidden header text no longer escapes the scroll box |
| Page 60 px wider than the screen | Admin catalogs, tablet | Grid is a single shrinkable column below the large breakpoint |
| Logo link had no accessible name | Phone, 6 pages | Brand text is visually hidden instead of `display: none` |
| Label did not contain the visible text | Assignee/Reporter buttons (issue list, issue detail) | Avatar inside a labelled button is decorative and draws its initials with CSS |
| Label did not contain the visible text | Create-project template cards | Card name comes from its own text |
| Search box squeezed to a sliver | Issue list, phone | Toolbar row wraps (fixed in PR #92) |

## Screenshots

Viewport-sized captures from the final run, after the fixes.

| Page | Phone (375 px) | Desktop (1440 px) |
|---|---|---|
| Org dashboard | [light](org-home-phone-light.png) · [paper](org-home-phone-paper.png) · [dark](org-home-phone-dark.png) | [light](org-home-desktop-light.png) · [paper](org-home-desktop-paper.png) · [dark](org-home-desktop-dark.png) |
| Issue list | [light](issues-phone-light.png) · [paper](issues-phone-paper.png) · [dark](issues-phone-dark.png) | [light](issues-desktop-light.png) · [paper](issues-desktop-paper.png) · [dark](issues-desktop-dark.png) |
| Scrum board | [light](board-scrum-phone-light.png) · [paper](board-scrum-phone-paper.png) · [dark](board-scrum-phone-dark.png) | [light](board-scrum-desktop-light.png) · [paper](board-scrum-desktop-paper.png) · [dark](board-scrum-desktop-dark.png) |
| Issue detail | [light](issue-detail-phone-light.png) · [paper](issue-detail-phone-paper.png) · [dark](issue-detail-phone-dark.png) | [light](issue-detail-desktop-light.png) · [paper](issue-detail-desktop-paper.png) · [dark](issue-detail-desktop-dark.png) |
| Admin · Audit log | [light](admin-audit-phone-light.png) · [paper](admin-audit-phone-paper.png) · [dark](admin-audit-phone-dark.png) | [light](admin-audit-desktop-light.png) · [paper](admin-audit-desktop-paper.png) · [dark](admin-audit-desktop-dark.png) |

## Re-running

```bash
make dev && make seed-demo          # API, worker, UI and the demo data
make e2e-visual-qa                  # all 243 combinations; screenshots in .tmp/visual-qa/
```

The spec is `frontend/e2e/visual-qa/responsive.spec.ts`. Set `E2E_BASE_URL` to the UI address. Every combination writes a screenshot and a small `<page>.json` result next to it; failures are reported per combination instead of stopping at the first.
