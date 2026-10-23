import "server-only";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const env = {
  supabaseUrl: () => need("SUPABASE_URL"),
  anonKey: () => need("SUPABASE_ANON_KEY"),
  serviceKey: () => need("SUPABASE_SERVICE_ROLE_KEY"),
};
