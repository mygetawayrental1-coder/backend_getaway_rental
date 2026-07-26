/**
 * One-off: copy public schema DATA from Neon → Railway.
 * Schema should already exist on Railway (prisma migrate deploy / db push).
 *
 * Usage:
 *   set SOURCE_DATABASE_URL=...
 *   set TARGET_DATABASE_URL=...
 *   node scripts/copy-neon-to-railway.js
 */
const { Client } = require('pg');

const SOURCE = process.env.SOURCE_DATABASE_URL;
const TARGET = process.env.TARGET_DATABASE_URL;

if (!SOURCE || !TARGET) {
  console.error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL');
  process.exit(1);
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function listTables(client) {
  const { rows } = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return rows.map((r) => r.tablename);
}

async function main() {
  const src = new Client({
    connectionString: SOURCE,
    ssl: { rejectUnauthorized: false },
  });
  const dst = new Client({
    connectionString: TARGET,
    ssl: { rejectUnauthorized: false },
  });

  console.log('Connecting…');
  await src.connect();
  await dst.connect();

  const srcTables = await listTables(src);
  const dstTables = new Set(await listTables(dst));
  console.log(`Source tables: ${srcTables.length}`);
  console.log(`Target tables: ${dstTables.size}`);

  const missing = srcTables.filter((t) => !dstTables.has(t));
  if (missing.length) {
    console.error(
      'Target is missing tables (run prisma db push / migrate deploy first):',
      missing,
    );
    process.exit(1);
  }

  // Disable FK checks; truncate everything once; then insert (no mid-loop truncate).
  await dst.query(`SET session_replication_role = 'replica'`);

  const allQuoted = srcTables.map((t) => quoteIdent(t)).join(', ');
  console.log('\nTruncating all target tables once…');
  await dst.query(`TRUNCATE TABLE ${allQuoted} RESTART IDENTITY CASCADE`);

  console.log('\nCopying tables…');
  let total = 0;
  for (const table of srcTables) {
    const qTable = quoteIdent(table);
    const { rows } = await src.query(`SELECT * FROM ${qTable}`);
    if (rows.length === 0) {
      console.log(`  ${table}: 0 rows`);
      continue;
    }

    const cols = Object.keys(rows[0]);
    const colList = cols.map(quoteIdent).join(', ');
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${qTable} (${colList}) VALUES (${placeholders})`;

    for (const row of rows) {
      await dst.query(sql, cols.map((c) => row[c]));
    }
    total += rows.length;
    console.log(`  ${table}: ${rows.length} rows`);
  }

  await dst.query(`SET session_replication_role = 'origin'`);

  console.log('\nVerifying counts…');
  const checkTables = [
    'User',
    'Property',
    'Booking',
    'GuestRequest',
    'Review',
    'Location',
    'Notification',
    '_prisma_migrations',
  ];
  let allOk = true;
  for (const table of checkTables) {
    if (!srcTables.includes(table)) continue;
    const s = await src.query(
      `SELECT COUNT(*)::int AS c FROM ${quoteIdent(table)}`,
    );
    const d = await dst.query(
      `SELECT COUNT(*)::int AS c FROM ${quoteIdent(table)}`,
    );
    const ok = s.rows[0].c === d.rows[0].c;
    if (!ok) allOk = false;
    console.log(
      `  ${table}: neon=${s.rows[0].c} railway=${d.rows[0].c} ${ok ? 'OK' : 'MISMATCH'}`,
    );
  }

  await src.end();
  await dst.end();

  if (!allOk) {
    console.error('\nFinished with mismatches — inspect before cutover.');
    process.exit(1);
  }
  console.log(`\nDone. Copied ${total} data rows. Counts match.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
