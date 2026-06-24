# Discovery Graph Product Direction

Date: 2026-06-24

## Product Thesis

Vaultr Discovery should feel less like a search result list and more like a collector taste engine: it notices the shape of what someone chases, builds a memory of adjacent collector concepts, and surfaces cards that feel personally plausible before the collector would have typed the exact query.

The current W26 work moved in that direction by separating broad taste signals from exact marketplace identity. The next product step is to formalize that separation as a graph.

## Why A Graph

Discovery is currently doing many graph-like things through local scoring rules:

- active chases imply subjects, eras, languages, releases, rarity tiers, and collector formats
- feedback adds or removes preference signals
- source catalogs connect Pokemon, sets, numbers, rarities, release regions, and images
- market cache connects exact suggestions to live evidence and confidence
- scheduled shelves need diversity, novelty, confidence, and personal fit

A graph gives those relationships a home. Instead of inventing a new lane every time one card teaches us something, Vaultr can keep broad signals broad and use exact identities only at evidence time.

## Core Model

Think in three layers.

### 1. Collector Taste Graph

User-specific graph built from active chases, removed chases, More Like feedback, Not For Me feedback, opened shelves, Add to Vault actions, and ignored/repeated cards.

Suggested node types:

- `collector:user`
- `card:identity`
- `subject:pokemon`
- `set`
- `era`
- `language`
- `release-pattern`
- `rarity-pattern`
- `artist`
- `finish`
- `price-band`
- `condition-band`
- `negative-signal`

Important edge types:

- `chases`
- `liked`
- `rejected`
- `added_to_vault`
- `contains_trait`
- `same_subject_as`
- `same_release_family_as`
- `same_collector_shape_as`
- `market_verified_as`

The key product rule: `same_collector_shape_as` can influence discovery, but only `market_verified_as` should justify exact listing evidence.

### 2. Card Knowledge Graph

Global graph from Pokemon TCG API, TCGdex, curated niche records, and eventually seller/title evidence that has been verified.

This graph should encode facts like:

- `Mew Japanese S12a 052` has subject `Mew`, language `Japanese`, set `VSTAR Universe`, number `052/172`, rarity `R`, finish variants like holo/reverse holo
- `Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese` has subject `Raichu`, language `Japanese`, release-pattern `deck-exclusive`, vintage era, exact marketplace aliases including `No.03` and `VHS`
- `Pikachu 010/018 McDonald's e-Reader 2002 Japanese` has subject `Pikachu`, language `Japanese`, release-pattern `retail promo`, era `e-reader`, number `010/018`

This graph should not be fully user-facing. It is the product's evidence layer.

### 3. Candidate Evidence Graph

Short-lived graph created per shelf refresh. It links generated candidates to source records, market samples, reference images, historical seen state, and feedback constraints.

This layer answers:

- Is the card exact enough to show?
- Is the market evidence reliable enough to price?
- Is the image trustworthy enough to render?
- Is this too close to a card the user rejected or already saw?
- Does it diversify the shelf or create subject spam?

## Recommendation Pipeline

1. Build the collector taste graph.
   - Weight active grails highest.
   - Keep removed taste memory as repeat guards and negative context.
   - Treat More Like as trait reinforcement, not only exact-card reinforcement.

2. Expand from taste graph to candidate neighborhoods.
   - Same subject variants.
   - Same release-pattern variants.
   - Cross-trait intersections, such as Japanese + e-reader + promo + Pikachu.
   - Scarcity/exclusivity patterns, such as deck-exclusive, lottery, event, club, magazine, vending, and regional promos.

3. Resolve candidates through the knowledge graph.
   - Prefer source-backed exact cards.
   - Allow curated niche identities where official APIs are thin.
   - Keep broad traits as scoring signals, not display names.

4. Verify evidence.
   - Marketplace titles must match exact identity constraints.
   - Market sample depth controls price confidence.
   - Display readiness and refresh completeness remain separate.

5. Assemble a shelf as a portfolio.
   - Mix exact grail-shaped picks, accessible adjacent picks, and one or two exploratory picks.
   - Enforce subject diversity unless a user strongly signals a subject focus.
   - Penalize ordinary format cards unless rarity/release context makes them collector-interesting.

6. Learn from interactions.
   - `Add to Vault` strengthens exact identity and its traits.
   - `More Like` strengthens shape and nearby traits.
   - `Not For Me` weakens exact identity, subject, format, or release traits depending on context.
   - Repeated ignores should softly decay a candidate shape.

## Scoring Shape

Discovery should move toward a score that can be explained as components:

- `taste_fit`: graph proximity to strong positive signals
- `collector_shape`: rarity, release pattern, language, era, subject, artist, finish, promo/exclusive traits
- `evidence_confidence`: source identity, market sample depth, image quality
- `novelty`: not recently seen, not too similar to prior shelf
- `diversity`: improves the shelf composition
- `affordability_fit`: aligns with user price bands without overfitting to max price
- `negative_fit`: conflicts with explicit rejections or weak signals

The user-facing copy should expose only the meaningful collector reasons, not the internal score names.

## Near-Term Implementation Plan

### Current First Step

The first ML-ready layer now lives in `src/commands/discover.ts`:

- `collectorDiscoveryFeatures(...)` extracts structured collector signals from a candidate and a user's taste profile.
- `collectorDiscoveryRankScore(...)` uses those features as a transparent scoring layer while keeping hard evidence, image, marketplace, and safety gates outside the score.
- Rendered Weekly Shelf cards are persisted to `discovery_training_examples` with feature JSON, score JSON, position, ranker version, and later feedback outcomes.
- `getDiscoveryLearnedSignalSummary(...)` turns labeled examples into bounded per-feature rank nudges so feedback can start changing ranking behavior without adding more card-specific rules.

This is intentionally not a black-box recommender yet. It turns today's collector intuition into inspectable features so future feedback can train better weights without losing product guardrails.

The next reduction in hand-holding should come from improving these learned summaries: compare shown features and positions against `MORE_LIKE_THIS` / `NOT_FOR_ME` outcomes, then tune weights or train a lightweight ranker from collector feedback rather than adding more bespoke card rules.

Manual steering boundary:

- Discovery should not hard-code Pokemon family adjacency or manually inject specific Pokemon identities as lane outcomes.
- Marketplace identity validation may stay specific when needed to avoid bad comps, but taste steering should come from source evidence, generic collector traits, and learned feedback traces.
- If a user repeatedly likes a subject, family, era, or release shape, that preference should enter through `discovery_training_examples` and learned feature/subject summaries rather than static code lists.

### Phase 1: Make Existing Signals Graph-Like

- Add a typed trait extraction module for card names, source records, and listing titles.
- Store normalized traits for candidates in a lightweight table or JSON column before creating a new graph database.
- Replace scattered regex-only taste checks with reusable trait predicates.
- Keep curated niche exceptions small and evidence-oriented.

### Phase 2: Persist Taste Edges

- Create `user_discovery_traits` or `user_taste_edges` from active chases and feedback.
- Store edge type, weight, source, first seen, last reinforced, and decay metadata.
- Backfill from existing chases, feedback, taste memory, and scheduled shelf history.

### Phase 3: Candidate Neighborhood Builder

- Generate candidate neighborhoods from trait intersections rather than direct string variants only.
- Example: `Japanese + e-reader + promo + Squirtle/Pikachu` should produce retail e-reader promo candidates without hardcoding every family.
- Example: `Japanese + unique/exclusive + Raichu` should discover deck-exclusive and vintage regional oddities without naming a permanent Raichu lane.

### Phase 4: Explainability And Controls

- Add an internal reason trace per candidate.
- Build user-facing `Why this?` copy from top collector traits.
- Add product controls later: less modern, more Japanese, fewer GX/VMAX, more oddball promos, more affordable, more vintage.

### Phase 5: App-Ready Read Model

- Extend prepared shelves with trait summaries, evidence confidence, refresh status, and feedback state.
- Keep Discord fast by rendering prepared outputs.
- Let the future app show richer explanations and tune controls without doing live marketplace work.

## Data Tables To Consider

Start relational; a graph database is not required yet.

- `card_traits(card_key, trait_type, trait_value, confidence, source, updated_at)`
- `user_taste_edges(user_id, trait_type, trait_value, edge_type, weight, source, first_seen_at, last_seen_at, decay_after)`
- `candidate_evidence(candidate_key, source_kind, source_id, confidence, evidence_json, updated_at)`
- `discovery_reason_traces(user_id, period_key, suggestion_name, reason_json, score_json, created_at)`

SQLite is enough for alpha. Postgres with indexed trait rows is a clean next step for beta. A dedicated graph database can wait until graph traversal complexity genuinely exceeds SQL.

## Product Guardrails

- Do not echo active chases as Discovery picks.
- Do not overfit to one newly liked card.
- Do not create permanent hyper-specific lanes when a broad trait signal is enough.
- Do not price thin markets as reliable.
- Do not use marketplace images unless exact identity and listing quality are vetted.
- Do not let conventional GX/VMAX/ex cards dominate unless rarity and collector-shape justify them.
- Do not hide niche cards just because official source APIs are incomplete.

## Success Metrics

- Shelf cards increasingly receive `Add to Vault` or `More Like` instead of no action.
- Fewer `Not For Me` actions caused by ordinary format filler.
- Exact niche cards retain or improve early shelf positions when supported by taste graph and evidence.
- Market-ready count stays healthy without suppressing scarce grail-shaped discoveries.
- Users can describe the shelf as surprising but still recognizably theirs.
