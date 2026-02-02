// Bridge module so legacy pages can import "@/lib/supabase/client"
// while the project keeps the existing supabase client helper.
//
// Expected existing helper: src/lib/supabaseClient.ts (imported as "@/lib/supabaseClient")
// which returns a browser Supabase client.

export { createClient } from "@/lib/supabaseClient";
