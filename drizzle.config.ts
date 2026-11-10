import { defineConfig } from 'drizzle-kit';

// Migrations are generated from src/db/schema.ts into ./drizzle and bundled
// into the app; src/db/migrate.ts applies them inside the browser on startup.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
