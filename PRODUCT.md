# Labscout — Product

**One line:** PitchBook for students. A VC types a thesis; Labscout returns the NYC students already publishing on it, ranked, with a 3-line "why meet them" brief and evidence links.

**Users:** associates and partners at pre-seed / seed funds; venture scouts. Today: hackathon judges (VCs) watching a live demo on a projector.

**Jobs:**
1. Turn a thesis into a ranked shortlist of students in under 20 s.
2. Trust each rank: every claim links to its source (paper, ORCID, GitHub, Hugging Face, NSF/NIH award, SEC/NY filing, news).
3. Forward a brief to a partner as-is.

**Surfaces (4 tabs):**
- **Search** (`/`): chat. Thesis in → ranked student cards as the reply. Follow-ups refine ("only Columbia", "current students only", "top 3", "with GitHub", "more like #2").
- **Hackathon** (`/hackathon`): every Deal Flow attendee from the organizers' team sheet, batch-run through the signal sources (`node scripts/hackathon.ts` → `public/data/hackathon.json`) and ranked; people and team views. Emails used for matching only, never published.
- **Sponsors** (`/sponsors`): live proof that NicrronNinoo, PRISM, akta.pro and Roundtable each run on every search.
- **Architecture** (`/docs`): how it works, data sources by founder-signal stage, REST + MCP endpoints, run locally.

**Voice:** short, concrete, no hype. Sentences under 15 words. Numbers over adjectives.

**Constraints:** zero npm dependencies, no build step, static HTML + vanilla JS, self-hosted fonts (venue Wi-Fi is unreliable), works offline via `/?mock=1`.

**Data truths:** Columbia, NYU, Cornell, Cornell Tech; papers 2024–26; OpenAlex + ORCID core, 24 founder-signal sources in `lib/sources/` (22 live, PatentsView + SBIR.gov built but upstream down; catalog in `docs/SOURCES.md`), akta.pro news. Every signal needs a name match plus institution, shared paper, ORCID or handle evidence. No LinkedIn, no Google Scholar scraping, no X/Twitter.
