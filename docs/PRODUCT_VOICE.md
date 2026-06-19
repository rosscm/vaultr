# Vaultr Product Voice

Vaultr should feel like a reliable collector SaaS product with a light Pokaccini-flavored warmth. Clarity comes first. Flavor belongs where it helps the product feel alive, not where a user needs exact controls, errors, or billing/access information.

## Voice Split

- Settings, errors, health, and plan state: professional, direct, low-friction
- Discovery, Weekly Shelf, and feedback moments: warmer, collector-native, lightly flavored
- Upgrade copy: polished SaaS with collector identity, not generic premium upsell language
- Operational docs: plain engineering language

## Canonical Terms

- `Pro`: plan or access identifier
- `Full Vault`: unlocked branded experience
- `Free Vault`: free branded experience
- `Weekly Shelf`: Discovery surface
- `trusted shops`: vetted shop storefront sources and shop-only restock signals; lowercase in prose, title case only in UI labels and choices
- `taste profile memory`: learned preference memory; lowercase unless it becomes a named user-facing surface
- `custom exclusions`: saved per-chase exclusion terms
- `tune-outs`: feedback actions or feedback events only
- `sightings`: alert/match moments users receive
- `grails`: collector-language shorthand for priority cards

Avoid older or blurrier alternatives in user-facing copy:

- Prefer `custom exclusions` over `negative keywords`, `tune-out rules`, or `blocked terms`
- Prefer `Full Vault` over `paid`, `premium`, or `unlocked tier`
- Prefer `Free Vault` over `free plan` when describing the user experience
- Prefer `taste profile memory` over `Taste Profile memory` until there is a named Taste Profile surface

## Tone Examples

Use crisp control copy:

- `Custom exclusions; type the word 'none' to remove saved terms`
- `Postal/ZIP region for eBay shipping; type the word 'off' to remove saved value`
- `trusted shops are a Pro control inside the Full Vault`

Use warmer Discovery copy:

- `Your Weekly Shelf is ready`
- `Full Vault gets the deeper Weekly Shelf with feedback-powered taste profile memory`
- `Collector picks are ready to browse`

Avoid flavor in high-stakes or corrective copy:

- Billing, access, validation, privacy, and health messages should not be cute
- Keep coffee/Pokaccini flavor in announcements and Discovery moments

## Punctuation

- Slash command descriptions: sentence fragments, no final period
- Slash option descriptions: sentence fragments, no final period; use semicolons for compact helper clauses
- Button labels: title case, no punctuation
- Embed titles: title case, no punctuation
- Embed field names: title case, no punctuation
- Short status lines: no final period when they are fragments
- Full explanatory sentences: use normal punctuation
- Bullet lists: omit final periods for fragments; use periods only when the bullet contains multiple full sentences
- Helper text with quoted input should be explicit: `type the word 'none'...`; avoid shorthand like `none` alone

## Capitalization

- Capitalize named product surfaces: `Full Vault`, `Free Vault`, `Weekly Shelf`
- Keep source categories and functional concepts lowercase in prose: `trusted shops`, `taste profile memory`, `custom exclusions`, `tune-outs`, `sightings`
- Keep `eBay` casing exact
- Use `Pro` in prose, `PRO` only for stored enum values or technical docs

## Product Boundaries

- Do not make Vaultr sound like marketplace-sniper tooling
- Emphasize collector fit, saved chases, grail sightings, and Discovery
- Keep source/search internals out of user-facing copy unless the user is in `/health` or docs
- When in doubt, choose the clearest wording over the cleverest wording