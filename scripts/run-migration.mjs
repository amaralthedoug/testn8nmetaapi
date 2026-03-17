import { readFile } from 'node:fs/promises';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migration = await readFile(new URL('../db/migrations/001_init.sql', import.meta.url), 'utf8');
await pool.query(migration);
await pool.end();
console.log('migration applied');
