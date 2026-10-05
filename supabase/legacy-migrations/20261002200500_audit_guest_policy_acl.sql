alter policy "ai_knowledge_chunks_org" on public.ai_knowledge_chunks to authenticated;
alter policy "ai_knowledge_documents_org" on public.ai_knowledge_documents to authenticated;
alter policy "document_extraction_fields_delete" on public.document_extraction_fields to authenticated;
alter policy "document_extraction_fields_insert" on public.document_extraction_fields to authenticated;
alter policy "document_extraction_fields_select" on public.document_extraction_fields to authenticated;
alter policy "document_extraction_fields_update" on public.document_extraction_fields to authenticated;