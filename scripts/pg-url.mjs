/**
 * Print DIRECT_URL with its password percent-encoded, for libpq tools.
 *
 * postgres.js parses a connection string leniently, so an unencoded `@` or `#`
 * in the password works fine from the app. libpq (psql, pg_dump) splits on the
 * last `@` and then fails to resolve a hostname that has half the password
 * glued to it. Rather than ask everyone to remember, this normalises the URL.
 *
 *   pg_dump "$(node scripts/pg-url.mjs)" -f backups/phase1.sql
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const raw = process.env.DIRECT_URL;
if (!raw) {
  console.error("DIRECT_URL is not set.");
  process.exit(1);
}

// Split manually: the URL parser has the same ambiguity libpq does.
const match = raw.match(/^(?<scheme>postgres(?:ql)?:\/\/)(?<creds>[^/]*)@(?<rest>[^@]+)$/);
if (!match?.groups) {
  process.stdout.write(raw);
  process.exit(0);
}

const { scheme, creds, rest } = match.groups;
const separator = creds.indexOf(":");
const user = separator === -1 ? creds : creds.slice(0, separator);
const password = separator === -1 ? "" : creds.slice(separator + 1);

const encoded =
  `${scheme}${encodeURIComponent(decodeURIComponent(user))}` +
  (password ? `:${encodeURIComponent(decodeURIComponent(password))}` : "") +
  `@${rest}`;

process.stdout.write(encoded);
