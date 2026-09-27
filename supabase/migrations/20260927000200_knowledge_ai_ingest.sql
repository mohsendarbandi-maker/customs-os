-- Customs OS AI Knowledge ingestion/review/vector search
alter type public.knowledge_source_status add value if not exists 'pending_review';
alter type public.knowledge_source_status add value if not exists 'rejected';

alter table public.knowledge_sources
  add column if not exists extracted_text text,
  add column if not exists ai_extraction jsonb not null default '{}'::jsonb,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists extraction_model text,
  add column if not exists extraction_confidence numeric(5,4);

create index if not exists idx_knowledge_sources_org_status_updated on public.knowledge_sources(organization_id,status,updated_at desc);
create index if not exists idx_knowledge_chunks_source_page on public.knowledge_chunks(source_id,page_number,chunk_index);
create index if not exists idx_knowledge_chunks_embedding_hnsw on public.knowledge_chunks using hnsw (embedding vector_cosine_ops) where embedding is not null;

create or replace function public.search_knowledge_semantic(query_embedding extensions.vector(1536),match_count integer default 10,match_threshold real default 0.20)
returns table(id uuid,source_id uuid,title text,source_number text,issued_at date,status public.knowledge_source_status,content text,page_number integer,similarity real)
language sql stable security invoker set search_path=public,extensions,pg_catalog
as $$
 select kc.id,kc.source_id,ks.title,ks.source_number,ks.issued_at,ks.status,kc.content,kc.page_number,
        1-(kc.embedding <=> query_embedding) as similarity
 from public.knowledge_chunks kc
 join public.knowledge_sources ks on ks.id=kc.source_id
 where kc.organization_id=public.user_org_id() and ks.status='active' and kc.embedding is not null
   and 1-(kc.embedding <=> query_embedding)>=match_threshold
 order by kc.embedding <=> query_embedding
 limit greatest(1,least(match_count,30));
$$;

create or replace function public.ai_find_knowledge(search_text text,org_id uuid,max_rows integer default 8)
returns table(id uuid,title text,content text,metadata jsonb)
language sql stable security invoker
set search_path=public,pg_catalog
as $$
 select ks.id,ks.title,
   coalesce(string_agg(kc.content,E'\n\n' order by kc.chunk_index),'') as content,
   ks.metadata || jsonb_build_object('source_number',ks.source_number,'issued_at',ks.issued_at,'effective_at',ks.effective_at,'issuer',ks.issuer,'subject',ks.subject,'status',ks.status) as metadata
 from public.knowledge_sources ks
 left join public.knowledge_chunks kc on kc.source_id=ks.id and kc.organization_id=ks.organization_id
 where ks.status='active' and ks.organization_id=org_id
   and (coalesce(search_text,'')='' or ks.title ilike '%'||search_text||'%' or ks.subject ilike '%'||search_text||'%' or kc.content ilike '%'||search_text||'%')
 group by ks.id
 order by ks.updated_at desc
 limit greatest(1,least(max_rows,20));
$$;

create index if not exists ai_action_proposals_interaction_idx on public.ai_action_proposals(interaction_id);
create index if not exists ai_evidence_interaction_idx on public.ai_evidence(interaction_id);
create index if not exists ai_risk_findings_interaction_idx on public.ai_risk_findings(interaction_id);
drop index if exists public.idx_knowledge_sources_org_status_updated;
