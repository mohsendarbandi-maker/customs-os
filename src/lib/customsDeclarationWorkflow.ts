// Canonical customs workflow rules live in the Supabase functions shared directory
// so the web application and daily Edge Function report use exactly the same logic.
export * from "../../supabase/functions/_shared/customsDeclarationWorkflow.ts";
