# Customs OS — AI Core v2 / 22-Phase Implementation Status

## Implemented in the repository

1. AI architecture audit — implemented.
2. Provider separation and fallback — implemented.
3. Modern model routing — AI Core uses Gemini 3.8 Flash for chat/agent, Gemini 3.5 Flash-Lite remains the stable document-extraction path, with Groq/OpenAI fallback.
4. Multimodal document intake — preserved for shipment documents and added to the knowledge ingestion flow.
5. Structured extraction — shipment extraction remains on the stable extractor; knowledge documents now use Gemini structured JSON extraction.
6. Evidence/provenance persistence — shipment_document_extractions and ai_evidence persist extracted evidence.
7. Operational context — shipments, clients, cases, declarations, customs data, documents, extractions, checklist, finance and vessels are loaded with organization scoping.
8. Deterministic validation — missing identifiers, conflicting extracted values and workflow gaps are detected deterministically.
9. Cross-document discrepancy detection — enabled from persisted extraction evidence.
10. AI Agent command mode — AI Core uses real operational records and deterministic selection.
11. Knowledge/RAG — canonical knowledge_sources/knowledge_chunks are now the active knowledge store; keyword + semantic vector retrieval are available.
12. Session memory — recent ai_interactions for the same session_id are supplied back to the model.
13. Long-term shipment evidence — ai_evidence is tied to shipment/document/field.
14. Risk engine — ai_risk_findings are generated for deterministic operational risks.
15. Action proposal boundary — agent mutation requests create audited ai_action_proposals with status=proposed; no natural-language mutation directly changes source-of-truth records.
16. Finance context — payments and payment requests are included in operational context.
17. Maritime context — vessel identity and stored position fields are included.
18. Voice command bridge — existing browser voice UI routes commands to AI Core.
19. Auditability — interactions, evidence, risks and action proposals are persisted.
20. Tenant/security boundary — organization-scoped queries, verify_jwt and RLS are enabled for AI data.
21. Production verification pipeline — GitHub main-branch workflow runs tests, typecheck and production build; current repository status must still be verified from CI/Vercel before calling production green.
22. UI integration — AIWorkspace uses AI Core for chat/agent commands; Knowledge Center uses the dedicated knowledge-ai ingestion/review function.

## Knowledge Center workflow

Upload a document from /knowledge:
1. AI reads the PDF/image/text.
2. AI extracts title, type, number, dates, issuer, subject, summary, full text and page-aware chunks.
3. The source is stored as pending_review.
4. A human reviews the extracted content.
5. Owner/admin can approve or reject.
6. Approval generates Gemini Embedding 2 vectors (1536 dimensions) for the chunks and activates the source.
7. Only active sources participate in knowledge retrieval.

## Deliberate safety boundaries

- AI never silently writes customs source-of-truth records from natural language.
- Mutation requests stop at an auditable action proposal until a typed executor is explicitly enabled.
- No customs law, circular, deadline or legal interpretation is fabricated or seeded automatically.
- Native realtime voice is not silently substituted for browser SpeechRecognition; it remains a separate future transport.

## Remaining external prerequisite

The architecture is implemented, but the quality of the legal knowledge layer depends on uploading the organization's actual laws, circulars, instructions and SOPs and approving them. Production deployment/build health must be verified through the connected Vercel/CI account before it can be called green.
