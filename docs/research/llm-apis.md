# Research: llm-apis

Researched 2026-11-26 by a background agent. Status labels: verified (ran it), documented (URL), inferred, unknown.

## Summary

1) [verified] Anthropic: /v1/models lists claude-fable-5-2, claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5 (all 1,000,000 ctx / 128,000 max output); SDK @anthropic-ai/sdk 1.14.0. 2) [verified] Prompt caching works on the cheapest current model (claude-haiku-5-5), streamed, ~5.1k-token system block with cache_control ephemeral. Call A: cache_creation_input_tokens=5112, cache_read=0, input_tokens=17. Call B: cache_creation=0, cache_read=5112, input_tokens=17. count_tokens returned 5120 for the same system plus "hi". 3) [verified] claude-haiku-5-5 has thinking ON by default: with max_tokens=50 (even output_config.effort=low) all 50 tokens went to a thinking block, stop_reason=max_tokens and ZERO text. With thinking:{type:"disabled"} or max_tokens=1024 it answered normally. The router must set max_tokens high (>=1024) or disable thinking, and must emit a "thinking" event or ignore thinking blocks. 4) [documented] Anthropic cache read multipliers differ per model: Haiku 5.5 0.1x ($0.01/MTok), Sonnet 5.5 and Opus 5.5 0.05x ($0.10 / $0.20), Fable 5.2 0.025x ($0.20); 5m write 1.25x, 1h write 2x; min cacheable prefix 512 tokens on all 5.x current models; max 4 breakpoints; 20-block lookback. Haiku 5.5 is priced by prompt length (<=100K: $0.10/$0.50, >100K: $0.50/$2.50, cache reads and writes count toward the 100K). 5) [documented, via official-page fetch, NOT called: no OpenAI/Gemini keys in secrets.env] OpenAI current IDs: gpt-6.2-astra ($8/$40), gpt-6.2-sol ($2/$10), gpt-6.1-terra ($1/$5), gpt-6-luna ($0.10/$0.50); 1.05M ctx, 128K max output; price steps up (input 2x, output 1.5x) above 272K input tokens; cached input is 0.05x on astra/sol/terra, 0.1x on luna; automatic caching, no write premium on earlier models but GPT-5.6+ models charge 1.25x write (30m) / 2.5x (12h); SDK openai 7.65.0. 6) [documented] Gemini current IDs: gemini-4-carbon ($2/$10 until Dec 1 2026, then $4/$20), gemini-4-argon (same), gemini-4-neon ($3/$15), gemini-4-hydrogen ($1.50/$7.50), gemini-3.8-flash ($0.75/$3.75, rising Jan 1 2027), gemini-3.5-flash-lite ($0.30/$2.50), gemini-3.1-flash-lite ($0.25/$1.50); Gemini 4 = 1M input; SDK @google/genai 3.6.1. A price change on Dec 1 2026 (5 days from today) means prices must live in config, not code. 7) [documented] Gemini implicit caching is on by default (min 4,096 tokens on Gemini 4/3.8/3.6/3.1 Pro; 2,048 on 2.5); explicit caching is NOT supported on Gemini 4 models, only Gemini 3 and 2.5 via generateContent. The caching page names usage.total_cached_tokens; the generateContent SDK type has usageMetadata.cachedContentTokenCount (verified in installed d.ts). 8) [verified in installed SDK types + tsc] A ChatProvider adapter for all three SDKs compiles under strict tsc; the Anthropic adapter was run live (usage and stop events normalised; second call showed cacheReadTokens=9864). 9) [documented] Native citations: only Anthropic has first-class citations over user-supplied documents (citations:{enabled:true} on document blocks, incompatible with output_config.format). OpenAI documents file_citation only through file_search (vector store); Gemini grounding metadata is tied to Google Search grounding. Recommend the provider-agnostic scheme: number sources in the cached prefix and have the model emit [n]. 10) [documented] New-account limits: Anthropic Start tier $500/mo cap, Haiku 5.5 4,000 RPM / 2M ITPM / 400K OTPM (cache reads do not count toward ITPM); OpenAI Free/Build($5 paid): Build 5,000 RPM, 1M TPM (astra/sol/terra), 2M (luna); Gemini Tier 1 = billing linked, Tier 2 = $100 paid + 3 days, per-model RPM/TPM only visible in AI Studio.

## Decisions

### Cheapest Anthropic model for cache tests and the router's fast tier

- **Recommendation** [verified]: Use claude-haiku-5-5 as the fast/cheap Anthropic tier and claude-opus-5-5 ($4/$20) or claude-sonnet-5-5 ($2/$10) as quality tier. Pass thinking:{type:'disabled'} (accepted on Haiku 5.5 at effort <= high) for plain chat routes, or max_tokens >= 1024.
- **Evidence**: GET /v1/models listed all four IDs with max_input_tokens 1000000, max_tokens 128000. Haiku 5.5 streamed with max_tokens=50 produced 50 thinking tokens and no text (stop_reason max_tokens); thinking disabled returned 'Hello there, friend!' in 10 tokens, thinking_tokens 0.
- **Cost**: Disabling thinking lowers quality on hard questions; thinking tokens are billed as output and count against max_tokens.

### Anthropic prompt caching setup for a long shared Space context

- **Recommendation** [verified]: Put the numbered-sources block in system as one text block with cache_control {type:'ephemeral'} (add ttl:'1h' for Spaces used less often than every 5 minutes: 2x write price pays off after 2 reads). Keep per-question content in messages after the breakpoint. Sum cache_read + cache_creation + input_tokens for total input.
- **Evidence**: Streamed twice on claude-haiku-5-5: call 1 cache_creation_input_tokens=5112 (ephemeral_5m_input_tokens=5112), call 2 cache_read_input_tokens=5112, input_tokens=17 both times. Adapter run: 9864 written then 9864 read.
- **Cost**: Cache is per model and exact-prefix: editing any source or reordering invalidates it; 5m TTL refreshes on each read. Minimum prefix is 512 tokens on 5.x models (documented; sub-minimum behaviour not tested).

### Anthropic token counting

- **Recommendation** [verified]: Use client.messages.countTokens({model, system, messages}) before sending, for budget pre-checks; it is model-specific.
- **Evidence**: Returned {input_tokens: 5120} for the 5112-token cached system block plus a short user message, matching call usage (5112+17 for a different short prompt).
- **Cost**: Extra network call (free per docs-known behaviour, rate-limited separately; not measured).

### Per-Space token budget accounting

- **Recommendation** [verified]: Accumulate normalised usage per Space: inputTokens (total incl. cache), cacheReadTokens, cacheWriteTokens, outputTokens (incl. reasoning). Convert to dollars with per-model multipliers from the catalog (cache read multiplier varies 0.025-0.1x).
- **Evidence**: Anthropic: final message usage fields seen live. OpenAI: ResponseUsage.input_tokens_details.{cached_tokens,cache_write_tokens} and output_tokens_details.reasoning_tokens in openai@7.65.0 d.ts. Gemini: usageMetadata.{promptTokenCount,cachedContentTokenCount,thoughtsTokenCount} in @google/genai@3.6.1 d.ts.
- **Cost**: OpenAI and Gemini usage shapes verified from types only, not from live responses (no keys). Gemini usageMetadata arrives on chunks; take the last one.

### OpenAI integration surface

- **Recommendation** [documented]: Use the Responses API (client.responses.create({stream:true})), instructions for the system prompt, stable content first. Read usage from response.completed/incomplete/failed event's response.usage. Add prompt_cache_key per Space. Do not assume a write premium for older models, but GPT-5.6+ bills 1.25x for writes.
- **Evidence**: https://developers.openai.com/api/docs/guides/prompt-caching (min 1,024 tokens GPT-5.6+, 0.05x read on gpt-6.2-astra/sol/terra, prompt_cache_options.ttl 30m|12h) and https://developers.openai.com/api/docs/guides/streaming-responses (response.output_text.delta, error). Event union and usage fields confirmed in openai@7.65.0 types.
- **Cost**: Page content came via a summarising fetch; exact wording unverified. Page does not say whether gpt-6.x models fall under the 'GPT-5.6 and later' rules (assumed yes). Does not document Chat Completions usage.

### OpenAI model catalog and prices

- **Recommendation** [documented]: Catalog: gpt-6.2-astra ($8/$40) quality, gpt-6.2-sol ($2/$10) balanced, gpt-6-luna ($0.10/$0.50) cheap; gpt-6.1-terra ($1/$5) optional. Model price tiers above 272K input tokens (input 2x, output 1.5x).
- **Evidence**: https://developers.openai.com/api/docs/models and https://developers.openai.com/api/docs/pricing (cached input astra $0.40, sol $0.10, terra $0.05, luna $0.01 per MTok; long-context rows).
- **Cost**: Not called: no OpenAI key. IDs could differ in availability per account/tier.

### Gemini integration surface and caching

- **Recommendation** [documented]: Use @google/genai ai.models.generateContentStream with config.systemInstruction. Rely on implicit caching (free, automatic) with stable prefix first and >= 4,096 tokens; do not build on explicit caches.create for Gemini 4 models (unsupported). Read usageMetadata from the last chunk.
- **Evidence**: https://aistudio.google.com/docs/caching: implicit on by default, 4,096-token minimum for Gemini 4/3.8/3.6/3.1 Pro, explicit caching 'not supported ... for Gemini 4 models'. Pricing page: context-cache read $0.10 vs $2.00 input on gemini-4-carbon (0.05x).
- **Cost**: Implicit caching gives no guarantee or control; page gives no discount percentage (inferred from the cache price column). Explicit-cache API details (ttl, min tokens) were not on the fetched page.

### Gemini model catalog and prices

- **Recommendation** [documented]: Quality: gemini-4-carbon; fast/cheap: gemini-4-hydrogen ($1.50/$7.50) or gemini-3.5-flash-lite ($0.30/$2.50, stable, 'cheapest' per models page). Store prices as dated rows: carbon/argon double on 2026-12-01, 3.8/3.6 flash double on 2027-01-01.
- **Evidence**: https://aistudio.google.com/docs/pricing and https://aistudio.google.com/docs/models (Gemini 4: 1M input, '64K / 1M' max output, unexplained).
- **Cost**: Gemini 3.x context/output limits not listed on the page (assumed 1M, inferred). gemini-2.5-flash-lite is cheaper ($0.10/$0.40) but older; gemini-2.5-pro/flash are deprecated and reroute on Dec 1.

### Overload and retry policy

- **Recommendation** [documented]: Treat 429 (honour retry-after), 500/502/503/504, 529 (Anthropic overloaded) and network errors as retryable with exponential backoff plus jitter and a cap; never retry 400/401/403/404. Anthropic spend-cap 429 has error.details.error_code 'enforced_spend_limit_reached' and no retry-after: do not retry. Anthropic 429 'ramp_limit_exceeded': ramp up traffic gradually. OpenAI overload is 503 server_is_overloaded; Gemini quota is 429 RESOURCE_EXHAUSTED.
- **Evidence**: https://platform.claude.com/docs/en/api/rate-limits (ramp limits, spend cap shape, retry-after, anthropic-ratelimit-* headers); https://developers.openai.com/api/docs/guides/rate-limits (429/503, Retry-After, x-ratelimit-*); https://aistudio.google.com/docs/rate-limits (429 RESOURCE_EXHAUSTED; 503 not covered).
- **Cost**: 529 for Anthropic overload is from prior knowledge of the API, not on the fetched rate-limit page. Mid-stream errors: Anthropic streams an error SSE event, OpenAI emits type 'error'; after bytes are streamed a retry duplicates text, so retry only before the first delta or restart the message in the UI.

### Citations

- **Recommendation** [documented]: Ship the provider-agnostic scheme: number sources [1..n] in the cached system prefix, require [n] markers, and validate markers against the source list on the client. Treat Anthropic native document citations as an optional later upgrade.
- **Evidence**: Anthropic: citations:{enabled:true} on document blocks returns char_location/page_location/content_block_location (claude-api skill; incompatible with structured outputs). OpenAI: only file_citation via file_search documented (https://developers.openai.com/api/docs/guides/tools-file-search). Gemini: no document-citation equivalent found on fetched pages.
- **Cost**: Model may emit wrong or out-of-range numbers; needs client-side validation and optionally a quote-check. Native Anthropic citations were not run live.

### New-account rate limit tiers

- **Recommendation** [documented]: Plan for Anthropic Start tier (monthly cap $500) and Gemini Tier 1; build backpressure and per-Space budgets so limits surface as a friendly error.
- **Evidence**: Anthropic Start tier Haiku 5.5: 4,000 RPM, 2,000,000 ITPM, 400,000 OTPM; Sonnet 5.5 and Opus 5.5 same TPM, 4,000 RPM; Fable 5.2 500K ITPM; caps Start $500, Build $1,000, Scale $200,000; new orgs may start in a lower Evaluation tier. OpenAI: Free $100/mo, Build $500 (needs $5), Launch $5,000 ($100), Grow $200,000 ($500); Build 5,000 RPM, 1M TPM on astra/sol/terra. Gemini: Tier 1 billing linked ($250 cap), Tier 2 $100 + 3 days, Tier 3 $1,000 + 30 days.
- **Cost**: The Anthropic org used here may sit in a different tier (not queried: no admin key); Gemini per-model RPM/TPM were not published on the fetched page.

## Versions

| Name | Version | Source |
| --- | --- | --- |
| @anthropic-ai/sdk | 1.14.0 | npm view @anthropic-ai/sdk version (2026-11-26); installed and run |
| openai | 7.65.0 | npm view openai version; installed, types inspected, tsc strict clean |
| @google/genai | 3.6.1 | npm view @google/genai version; installed, types inspected, tsc strict clean |

## Details

## 0. Evidence key
- verified = I called it (Anthropic: models endpoint, streamed messages, count_tokens, adapter) or checked installed SDK types and compiled with strict tsc (OpenAI 7.65.0, @google/genai 3.6.1).
- documented = official page fetched (fetch tool summarises pages with a small model: re-read before locking prices).
- inferred = my reasoning.
No OpenAI/Gemini keys exist in /root/.config/tiger/secrets.env (only ANTHROPIC_API_KEY), so those two providers were never called. Spend: about 60k input tokens on Anthropic, all on claude-haiku-5-5 (well under 200k).

## 1. ModelCatalog (JSON)
Prices are USD per million tokens (standard tier, short context). `cacheReadMult` / `cacheWriteMult` added because they differ per model. Put this in a config file with `effectiveFrom`, because prices change on 2026-12-01 and 2027-01-01.

```json
[
 {"provider":"anthropic","id":"claude-opus-5-5","label":"Claude Opus 5.5","tier":"quality","contextWindow":1000000,"maxOutput":128000,"inputPricePerMTok":4.00,"outputPricePerMTok":20.00,"supportsCaching":true,"cacheMinTokens":512,"cacheReadMult":0.05,"cacheWriteMult5m":1.25,"cacheWriteMult1h":2,
  "status":"verified (listed by GET /v1/models); price documented","priceSource":"https://platform.claude.com/docs/en/about-claude/pricing"},
 {"provider":"anthropic","id":"claude-sonnet-5-5","label":"Claude Sonnet 5.5","tier":"balanced","contextWindow":1000000,"maxOutput":128000,"inputPricePerMTok":2.00,"outputPricePerMTok":10.00,"supportsCaching":true,"cacheMinTokens":512,"cacheReadMult":0.05,"cacheWriteMult5m":1.25,"cacheWriteMult1h":2,
  "status":"verified (listed); price documented","priceSource":"https://platform.claude.com/docs/en/about-claude/pricing"},
 {"provider":"anthropic","id":"claude-haiku-5-5","label":"Claude Haiku 5.5","tier":"fast","contextWindow":1000000,"maxOutput":128000,"inputPricePerMTok":0.10,"outputPricePerMTok":0.50,"longContext":{"overPromptTokens":100000,"inputPricePerMTok":0.50,"outputPricePerMTok":2.50},"supportsCaching":true,"cacheMinTokens":512,"cacheReadMult":0.1,"cacheWriteMult5m":1.25,"cacheWriteMult1h":2,
  "status":"verified: listed, called, cache write+read measured; price documented","priceSource":"https://platform.claude.com/docs/en/about-claude/pricing"},
 {"provider":"anthropic","id":"claude-fable-5-2","label":"Claude Fable 5.2","tier":"max","contextWindow":1000000,"maxOutput":128000,"inputPricePerMTok":8.00,"outputPricePerMTok":40.00,"supportsCaching":true,"cacheMinTokens":512,"cacheReadMult":0.025,"cacheWriteMult5m":1.25,"cacheWriteMult1h":2,
  "status":"verified (listed); price documented","priceSource":"https://platform.claude.com/docs/en/about-claude/pricing"},

 {"provider":"openai","id":"gpt-6.2-astra","label":"GPT-6.2 Astra","tier":"quality","contextWindow":1050000,"maxOutput":128000,"inputPricePerMTok":8.00,"outputPricePerMTok":40.00,"longContext":{"overPromptTokens":272000,"inputPricePerMTok":16.00,"outputPricePerMTok":60.00},"cachedInputPricePerMTok":0.40,"supportsCaching":true,"cacheMinTokens":1024,
  "status":"documented","priceSource":"https://developers.openai.com/api/docs/pricing ; ids/context: https://developers.openai.com/api/docs/models"},
 {"provider":"openai","id":"gpt-6.2-sol","label":"GPT-6.2 Sol","tier":"balanced","contextWindow":1050000,"maxOutput":128000,"inputPricePerMTok":2.00,"outputPricePerMTok":10.00,"longContext":{"overPromptTokens":272000,"inputPricePerMTok":4.00,"outputPricePerMTok":15.00},"cachedInputPricePerMTok":0.10,"supportsCaching":true,"cacheMinTokens":1024,
  "status":"documented","priceSource":"https://developers.openai.com/api/docs/pricing"},
 {"provider":"openai","id":"gpt-6-luna","label":"GPT-6 Luna","tier":"fast","contextWindow":1050000,"maxOutput":128000,"inputPricePerMTok":0.10,"outputPricePerMTok":0.50,"longContext":{"overPromptTokens":272000,"inputPricePerMTok":0.20,"outputPricePerMTok":0.75},"cachedInputPricePerMTok":0.01,"supportsCaching":true,"cacheMinTokens":1024,
  "status":"documented (cache minimum inferred from 'GPT-5.6 and later' wording)","priceSource":"https://developers.openai.com/api/docs/pricing"},
 {"provider":"openai","id":"gpt-6.1-terra","label":"GPT-6.1 Terra","tier":"fast-plus","contextWindow":1050000,"maxOutput":128000,"inputPricePerMTok":1.00,"outputPricePerMTok":5.00,"cachedInputPricePerMTok":0.05,"supportsCaching":true,"cacheMinTokens":1024,
  "status":"documented","priceSource":"https://developers.openai.com/api/docs/pricing"},

 {"provider":"google","id":"gemini-4-carbon","label":"Gemini 4 Carbon","tier":"quality","contextWindow":1000000,"maxOutput":64000,"inputPricePerMTok":2.00,"outputPricePerMTok":10.00,"scheduledChange":{"effective":"2026-12-01","inputPricePerMTok":4.00,"outputPricePerMTok":20.00},"cachedInputPricePerMTok":0.10,"supportsCaching":true,"cacheKind":"implicit only (explicit unsupported on Gemini 4)","cacheMinTokens":4096,
  "status":"documented","priceSource":"https://aistudio.google.com/docs/pricing ; limits https://aistudio.google.com/docs/models (max output listed as '64K / 1M', unexplained)"},
 {"provider":"google","id":"gemini-4-hydrogen","label":"Gemini 4 Hydrogen","tier":"fast","contextWindow":1000000,"maxOutput":64000,"inputPricePerMTok":1.50,"outputPricePerMTok":7.50,"cachedInputPricePerMTok":0.075,"supportsCaching":true,"cacheKind":"implicit only","cacheMinTokens":4096,
  "status":"documented","priceSource":"https://aistudio.google.com/docs/pricing"},
 {"provider":"google","id":"gemini-3.5-flash-lite","label":"Gemini 3.5 Flash-Lite","tier":"cheap","contextWindow":null,"maxOutput":null,"inputPricePerMTok":0.30,"outputPricePerMTok":2.50,"cachedInputPricePerMTok":0.03,"storagePerMTokHour":1.00,"supportsCaching":true,"cacheKind":"implicit + explicit","cacheMinTokens":null,
  "status":"documented (context window and cache minimum not on the fetched pages; 1M is inferred)","priceSource":"https://aistudio.google.com/docs/pricing"},
 {"provider":"google","id":"gemini-3.1-flash-lite","label":"Gemini 3.1 Flash-Lite","tier":"cheap","contextWindow":null,"inputPricePerMTok":0.25,"outputPricePerMTok":1.50,"cachedInputPricePerMTok":0.025,"supportsCaching":true,"status":"documented","priceSource":"https://aistudio.google.com/docs/pricing"}
]
```
Other Gemini rows seen (documented): gemini-4-argon $2/$10 (to $4/$20 on 2026-12-01), gemini-4-neon $3/$15, gemini-3.8-flash $0.75/$3.75 (to $1.50/$7.50 on 2027-01-01), gemini-3.1-pro-preview $2/$12 (<=200k) preview. gemini-2.5-pro and 2.5-flash are deprecated, rerouted 2026-12-01. Older cheap option gemini-2.5-flash-lite $0.10/$0.40.

## 2. Normalised interface (compiles under strict tsc; full file with all three adapters: /tmp/claude-0/-home-user-tiger-browser/7fb777b9-ce60-5e03-9bbf-edbf28d5b761/scratchpad/prov/providers.ts)
```ts
export type StopReason = "end" | "max_tokens" | "refusal" | "filtered" | "other";
export interface Usage { inputTokens: number;      // TOTAL input incl. cache read + write
  outputTokens: number;                           // incl. reasoning/thinking tokens
  cacheReadTokens: number; cacheWriteTokens: number; reasoningTokens?: number }
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "usage"; usage: Usage }
  | { type: "stop"; reason: StopReason; raw: string }
  | { type: "error"; retryable: boolean; status?: number; message: string };
export interface ChatRequest { model: string; systemStable: string;   // instructions + numbered sources: the cacheable prefix
  messages: { role: "user" | "assistant"; content: string }[]; maxOutputTokens: number; signal?: AbortSignal }
export interface ChatProvider { readonly id: "anthropic" | "openai" | "google";
  stream(req: ChatRequest): AsyncIterable<ChatEvent>;
  countTokens(req: Omit<ChatRequest, "maxOutputTokens" | "signal">): Promise<number> }
```
Event mapping:
| common | Anthropic (verified live) | OpenAI Responses (types verified) | Gemini (types verified) |
|---|---|---|---|
| text | content_block_delta with delta.type=text_delta (delta.text) | response.output_text.delta (event.delta) | chunk.text |
| usage | finalMessage().usage (message_start has input, message_delta has output) | response.completed/incomplete event.response.usage | last chunk.usageMetadata |
| stop | message.stop_reason end_turn/max_tokens/refusal/stop_sequence/tool_use/pause_turn | response.completed => end; response.incomplete + incomplete_details.reason (max_output_tokens, content_filter) | candidates[0].finishReason STOP/MAX_TOKENS/SAFETY/BLOCKLIST/PROHIBITED_CONTENT/RECITATION |
| error | thrown Anthropic.APIError (status) or SSE error event | event type "error" {code,message}; response.failed; thrown OpenAI.APIError | thrown error with .status |
| also seen (ignore or surface) | content_block_start:thinking, thinking_delta, signature_delta | response.reasoning_* events | thought parts |

## 3. Minimal streaming + caching per provider (TypeScript)

### Anthropic (RAN, verified)
```ts
import Anthropic from "@anthropic-ai/sdk";               // 1.14.0
const client = new Anthropic();                           // ANTHROPIC_API_KEY
const s = client.messages.stream({
  model: "claude-haiku-5-5",
  max_tokens: 1024,                                       // thinking is on by default: 50 was ALL consumed by thinking
  // thinking: { type: "disabled" },                      // verified accepted on Haiku 5.5; use for plain chat
  system: [{ type: "text", text: systemStable, cache_control: { type: "ephemeral" /* , ttl: "1h" */ } }],
  messages,
});
for await (const e of s) if (e.type === "content_block_delta" && e.delta.type === "text_delta") onText(e.delta.text);
const m = await s.finalMessage();
// m.usage: input_tokens (after last breakpoint only), cache_creation_input_tokens, cache_read_input_tokens, output_tokens,
//          cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}, output_tokens_details.thinking_tokens
const total = m.usage.input_tokens + (m.usage.cache_creation_input_tokens ?? 0) + (m.usage.cache_read_input_tokens ?? 0);
const n = await client.messages.countTokens({ model, system: systemStable, messages }); // n.input_tokens
```
Measured: call 1 {input_tokens:17, cache_creation_input_tokens:5112, cache_read_input_tokens:0}; call 2 {17, 0, 5112}. System-prompt placement: top-level `system`. Auto-caching alternative: top-level `cache_control` on the request (one of the 4 breakpoint slots). Client already retries 408/409/429/5xx twice by default.

### OpenAI (compiles; NOT run)
```ts
import OpenAI from "openai";                              // 7.65.0
const c = new OpenAI();
const s = await c.responses.create({
  model: "gpt-6.2-sol", stream: true, max_output_tokens: 2048,
  instructions: systemStable,                             // system placement; keep stable content first
  input: messages,                                        // [{role,content}]
  prompt_cache_key: `space:${spaceId}`,                   // routing / accounting
  // prompt_cache_options: { ttl: "12h" },                // GPT-5.6+: "30m" default; 12h costs 2.5x write vs 1.25x
  store: false,
});
for await (const e of s) {
  if (e.type === "response.output_text.delta") onText(e.delta);
  else if (e.type === "response.completed" || e.type === "response.incomplete") {
    const u = e.response.usage!;  // input_tokens, output_tokens, input_tokens_details.{cached_tokens,cache_write_tokens}, output_tokens_details.reasoning_tokens
  } else if (e.type === "error") onError(e.message);
}
const { input_tokens } = await c.responses.inputTokens.count({ model, instructions: systemStable, input: messages });
```
Caching is automatic: whole prefix must match; min 1,024 tokens (GPT-5.6+); read 0.05x on astra/sol/terra, 0.1x luna; cached tokens still count toward TPM.

### Gemini (compiles; NOT run)
```ts
import { GoogleGenAI } from "@google/genai";              // 3.6.1
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const stream = await ai.models.generateContentStream({
  model: "gemini-4-hydrogen",
  contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
  config: { systemInstruction: systemStable, maxOutputTokens: 2048, abortSignal: signal },
});
let usage; for await (const ch of stream) { if (ch.text) onText(ch.text); if (ch.usageMetadata) usage = ch.usageMetadata; }
// usage.promptTokenCount, candidatesTokenCount, thoughtsTokenCount, cachedContentTokenCount, totalTokenCount
const { totalTokens } = await ai.models.countTokens({ model, contents });
// Implicit caching: nothing to configure; put the big stable block first and send >= 4,096 tokens.
// Explicit (Gemini 3.x / 2.5 only): const cache = await ai.caches.create({ model, config: { contents, systemInstruction, ttl: "3600s" } });
//   then generateContent({ model, contents, config: { cachedContent: cache.name } })   // ttl string format and storage billing: unverified
```

## 4. Retry guidance (documented)
- Anthropic: 429 rate_limit_error (header retry-after; anthropic-ratelimit-* headers), 529 overloaded_error, 5xx; error subcodes in error.details.error_code: enforced_spend_limit_reached (no retry-after; do not retry), ramp_limit_exceeded (raise traffic <= 1 step/min). Limits are token-bucket; only input_tokens + cache_creation count toward ITPM, cache reads are free of ITPM.
- OpenAI: 429 rate_limit_error/slow_down, 503 server_is_overloaded; honour Retry-After, else exponential backoff with jitter; do not retry quota/billing errors; x-ratelimit-* headers; ramp traffic <= 50% per 15 min once at 1M input TPM.
- Gemini: 429 RESOURCE_EXHAUSTED; 503 not covered on the fetched page.
- Policy: retry only if no text delta has been emitted yet (or restart the message); jittered backoff, max 3 attempts, then fail over to another provider only if the user enabled it.

## 5. Rate limits for a brand-new account (documented)
| Provider | Start | Notes |
|---|---|---|
| Anthropic | Start tier: spend cap $500/mo; Haiku/Sonnet/Opus 5.5 each 4,000 RPM, 2,000,000 ITPM, 400,000 OTPM; Fable 5.2 500K ITPM/100K OTPM. Build: $1,000 cap, 10,000 RPM, 5M ITPM. Scale: $200,000 cap. New orgs may begin in a lower Evaluation tier | tier assigned automatically from history |
| OpenAI | Free ($100/mo, allowed geographies); Build needs $5 total purchases ($500/mo; 5,000 RPM, 1M TPM astra/sol/terra, 2M luna); Launch $100 ($5,000/mo); Grow $500 ($200,000/mo) | automatic upgrade on cumulative purchases |
| Gemini | Tier 1: billing account linked ($250 cap); Tier 2: $100 paid + 3 days; Tier 3: $1,000 + 30 days | per-model RPM/TPM only in AI Studio |

## 6. Citations
Anthropic native: `{type:"document", source:{type:"text"|"base64"|..., ...}, title, citations:{enabled:true}}` returns text blocks with citations[] (char_location / page_location / content_block_location, cited_text, document_index). It is incompatible with output_config.format and splits the response into many text blocks, which complicates the common stream. OpenAI: file_citation annotations only via file_search (needs a vector store). Gemini: grounding metadata for Search grounding, no user-document equivalent found. Therefore: one scheme for all providers. Number sources in the cached prefix as `[1] <title> <url>\n<text>`, instruct "cite with [n]", parse markers client-side, drop unknown n.

## 7. Cost sketch for a 100k-token Space context (documented prices, my arithmetic, inferred)
Per question after the first, cached prefix cost per call: Haiku 5.5 at <=100K: 0.1M x $0.01 = $0.001 (first call write $0.0125 at 1.25x); Sonnet 5.5: $0.01; Opus 5.5: $0.02; gpt-6-luna: $0.001; gpt-6.2-sol: $0.01; gemini-4-hydrogen: ~$0.0075 (implicit, not guaranteed). Note Haiku 5.5 steps to $0.50 input once the prompt exceeds 100K tokens (counting cache reads).

## Risks

- OpenAI and Gemini model IDs, prices, cache minimums and rate limits came from official pages read through a summarising fetch tool and were never exercised with a key. The model names (gpt-6.2-astra, gemini-4-carbon) are unfamiliar to my training, so they must be confirmed with GET /v1/models (OpenAI) and models.list (Gemini) as soon as keys exist.
- Haiku 5.5 thinks by default: any small max_tokens (e.g. 50 for titles or classification) can return empty text with stop_reason max_tokens. Set max_tokens >= 1024 or thinking disabled, and surface thinking blocks as a separate (ignored) event.
- Prices change within days: Gemini 4 Carbon/Argon double on 2026-12-01, 3.8/3.6 Flash on 2027-01-01, gemini-2.5-* reroute 2026-12-01. Hard-coded prices will make the per-Space budget wrong.
- Haiku 5.5 has two price levels (100K prompt-token threshold including cache reads); a large Space context crosses it and costs 5x per token. OpenAI also surcharges above 272K input tokens.
- Gemini 4 does not support explicit context caching; only best-effort implicit caching (min 4,096 tokens; multi-turn reuse needs >= 2,050 new tokens). Per-Space budgeting on Gemini cannot rely on cache hits.
- Cache TTL of 5 minutes (Anthropic default) means a Space idle for longer pays the write price again; 1h TTL costs 2x on write.
- Mid-stream failures after text was already emitted cannot be transparently retried without duplicating output.
- The user-relayed request text contained a raw API key; it was not used or printed, and the key in secrets.env was used via environment only. That pasted key should be treated as exposed and rotated.
- Anthropic native citations and OpenAI/Gemini counting endpoints were not exercised live; OpenAI responses.inputTokens.count and Gemini countTokens are checked against types only.

## Open questions

- Do we have (or can we get) OpenAI and Gemini API keys so the catalog IDs, usage fields and cached_tokens behaviour can be verified live?
- What are the real Gemini 3.x context and output limits and the explicit-cache API (ttl format, minimum tokens)? The fetched pages did not give them.
- Is thinking wanted by default for Tiger chat (quality, cost) or should the router disable it for fast-tier models and expose a per-model effort setting?
- Should the router fail over across providers on 529/503, and if so how is the partly-streamed answer handled?
- Which Anthropic usage tier is the org on? Rate limits were read from docs; an admin key or the Console limits page would show the real numbers.
- Is a 1-hour cache TTL acceptable for Spaces (2x write) given expected idle gaps, or should we pre-warm with max_tokens 0?
