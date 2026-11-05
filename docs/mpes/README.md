# MPES — MixNMatch Product Engineering Standard

> **In plain words**
> This folder is the rulebook every MixNMatch product follows. It was written by reading the real mix n match code, not by guessing.
> It says what exists today, what kind of product it is, how it compares to others, which parts every future product should share, the quality rules (security, accessibility, speed, testing), what every product must have, and what to build next, in order.
> Rules marked **MUST** are checked by `npm test` wherever a machine can check them (see `test/mpes.test.ts`).

**Version:** 1.0 · **Date:** 2 Nov 2026 · **Based on:** `main` at `0e734e5` (PR #7)
**Applies to:** mix n match today, and every future MixNMatch product.

## The seven parts

| # | Document | Answers |
|---|---|---|
| 1 | [Codebase audit](01-codebase-audit.md) | What is really in the code? What is good, what is risky? |
| 2 | [Product classification](02-product-classification.md) | What kind of product is this, for whom, for what? |
| 3 | [Competitive analysis](03-competitive-analysis.md) | Who else does this, and what does a top-tier product in this category offer? |
| 4 | [Shared architecture](04-shared-architecture.md) | Which parts should every product reuse instead of rebuilding? |
| 5 | [Engineering standards](05-engineering-standards.md) | Security, accessibility, performance, testing, operations rules |
| 6 | [Product specifications](06-product-specifications.md) | The checklist every product must pass before launch |
| 7 | [Implementation roadmap](07-implementation-roadmap.md) | What to do next, in order, with "done when" checks |

## How to read the rules

| Word | Meaning |
|---|---|
| **MUST** | Required. A product that breaks it does not ship. |
| **SHOULD** | Expected. Skipping it needs a written reason in the product's docs. |
| **MAY** | Optional, a good idea when it fits. |

Every rule has an ID such as `SEC-03` or `A11Y-02`. The roadmap and the checklist point to these IDs, so you can follow one rule from "why" to "done".

## Existing vs. proposed

Each document labels what it describes:

- ✅ **Exists** — in the code today, with a file path you can open.
- 🟡 **Partial** — some of it exists.
- 📝 **Proposed** — not built; a recommendation.

## Relationship to the other docs

The numbered docs in `docs/` (01 PRD … 11 spec v1.3) describe **mix n match the product**. MPES describes **how any MixNMatch product is built**. When they disagree, the product docs say what the product does, and MPES says how well it must do it.
