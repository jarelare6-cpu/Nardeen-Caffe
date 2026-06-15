import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'fs';
const root=new URL('../',import.meta.url);
export async function freshDB({migrated=false}={}){
  const db=new PGlite();
  await db.exec("CREATE PUBLICATION supabase_realtime;");
  await db.exec("CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $fn$ select null::uuid $fn$;");
  for(const r of ['anon','authenticated','service_role','postgres']){
    await db.exec(`DO $do$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${r}') THEN CREATE ROLE ${r}; END IF; END $do$;`);
  }
  await db.exec(readFileSync(new URL('db/schema_full.sql',root),'utf8'));
  if(migrated) await db.exec(readFileSync(new URL('db/migrations/2026-06-15_combined.sql',root),'utf8'));
  return db;
}
