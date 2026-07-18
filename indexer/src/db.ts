import Database from "better-sqlite3";
import type { Correction } from "@danfo/sdk";
import { config } from "./config";

export const db: Database.Database = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS corrections (
  id            INTEGER PRIMARY KEY,
  contributor   TEXT    NOT NULL,
  route_id      TEXT    NOT NULL,
  kind          INTEGER NOT NULL,
  summary       TEXT    NOT NULL,
  payload_hash  TEXT    NOT NULL,
  stake         TEXT    NOT NULL,
  status        INTEGER NOT NULL,
  submitted_at  INTEGER NOT NULL,
  finalize_after INTEGER NOT NULL,
  approvals     INTEGER NOT NULL,
  rejections    INTEGER NOT NULL,
  claimed       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON corrections(status);
CREATE INDEX IF NOT EXISTS idx_corrections_contributor ON corrections(contributor);
`);

const upsertStmt = db.prepare(`
INSERT INTO corrections
  (id, contributor, route_id, kind, summary, payload_hash, stake, status,
   submitted_at, finalize_after, approvals, rejections, updated_at)
VALUES
  (@id, @contributor, @route_id, @kind, @summary, @payload_hash, @stake,
   @status, @submitted_at, @finalize_after, @approvals, @rejections, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  status = excluded.status,
  approvals = excluded.approvals,
  rejections = excluded.rejections,
  updated_at = excluded.updated_at
`);

export function upsertCorrection(c: Correction): void {
  if (c.id === undefined) return;
  upsertStmt.run({
    id: c.id,
    contributor: c.contributor,
    route_id: c.routeId,
    kind: c.kind,
    summary: c.summary,
    payload_hash: Buffer.from(c.payloadHash).toString("hex"),
    stake: c.stake.toString(),
    status: c.status,
    submitted_at: c.submittedAt,
    finalize_after: c.finalizeAfter,
    approvals: c.approvals,
    rejections: c.rejections,
    updated_at: Date.now(),
  });
}

export function markClaimed(id: number): void {
  db.prepare("UPDATE corrections SET claimed = 1, updated_at = ? WHERE id = ?").run(
    Date.now(),
    id
  );
}

export function maxId(): number {
  const row = db.prepare("SELECT MAX(id) AS m FROM corrections").get() as {
    m: number | null;
  };
  return row.m ?? -1;
}

export function pendingIds(): number[] {
  return (
    db.prepare("SELECT id FROM corrections WHERE status = 0").all() as {
      id: number;
    }[]
  ).map((r) => r.id);
}

export function acceptedUnclaimedIds(): number[] {
  return (
    db
      .prepare("SELECT id FROM corrections WHERE status = 1 AND claimed = 0")
      .all() as { id: number }[]
  ).map((r) => r.id);
}

export function listCorrections(status?: number, limit = 50): any[] {
  if (status === undefined) {
    return db
      .prepare("SELECT * FROM corrections ORDER BY id DESC LIMIT ?")
      .all(limit);
  }
  return db
    .prepare(
      "SELECT * FROM corrections WHERE status = ? ORDER BY id DESC LIMIT ?"
    )
    .all(status, limit);
}

export function getCorrection(id: number): any {
  return db.prepare("SELECT * FROM corrections WHERE id = ?").get(id);
}

export function contributorRows(address: string): any[] {
  return db
    .prepare(
      "SELECT * FROM corrections WHERE contributor = ? ORDER BY id DESC"
    )
    .all(address);
}

export function stats(): { total: number; accepted: number; pending: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS accepted,
              SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS pending
       FROM corrections`
    )
    .get() as any;
  return {
    total: row.total ?? 0,
    accepted: row.accepted ?? 0,
    pending: row.pending ?? 0,
  };
}
