# Customs OS — AI Core v2 / 22-Phase Implementation

1. AI architecture audit — completed.
2. Provider separation and fallback — completed.
3. Modern model routing — AI Core uses Gemini 3.8 Flash for agent/chat and Gemini 3.5 Flash-Lite for extraction; Groq/OpenAI fallback.
4. Multimodal document intake — preserved through existing extraction path.
5. Structured extraction — preserved through ai-assistant.
6. Evidence/provenance persistence — ai_evidence plus shipment_document_extractions.
7. Operational context — shipments, clients, cases, declarations, customs data, documents, extractions, checklist, finance, vessels.
8. Deterministic validation — missing identifiers, duplicate/conflicting extracted values, stage 4/5 workflow gaps.
9. Cross-document discrepancy detection — enabled from persisted extraction evidence.
10. AI Agent command mode — AI Core selects relevant operational records and reasons over validated context.
11. Knowledge/RAG foundation — ai_knowledge_documents + ai_find_knowledge; source documents can be added without changing application schema.
12. Session memory — ai_interactions and session_id.
13. Long-term shipment evidence — ai_evidence tied to shipment/document/field.
14. Risk engine — ai_risk_findings.
15. Action proposal boundary — ai_action_proposals; requested changes are proposed, not silently written.
16. Finance context — payments and payment requests are included in operational context.
17. Maritime context — vessel identity and latest stored position fields are included.
18. Voice command bridge — existing voice UI now routes commands to AI Core agent.
19. Auditability — AI interactions, evidence, risk findings and action proposals are persisted.
20. Tenant/security boundary — organization-scoped queries, verify_jwt, RLS on AI tables.
21. Production verification pipeline — GitHub build/typecheck/test workflows triggered by changes.
22. UI integration — AIWorkspace routes chat/commands to AI Core while document extraction remains on the stable extraction function.

## Deliberate safety boundary

The AI Core never directly mutates customs source-of-truth data from natural-language commands. Mutations must pass through a typed action executor with validation and audit logging. This prevents an LLM hallucination from becoming a customs record.

## Remaining external prerequisites

A fully semantic vector RAG index requires an embedding provider/key and ingestion of the organization's actual regulations/SOP documents. No legal/customs rule content is fabricated by this implementation. Realtime native voice requires browser/client integration with Gemini Live and is separate from browser SpeechRecognition fallback.
