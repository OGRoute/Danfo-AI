import express from "express";
import { RegistryClient, RewardsClient } from "@danfo/sdk";
import { logger } from "./logger";
import {
  contributorRows,
  getCorrection,
  listCorrections,
  stats,
} from "./db";

export function startServer(
  registry: RegistryClient,
  rewards: RewardsClient | null,
  port: number
): void {
  const app = express();

  // The web app is served from another origin (Vercel) — allow reads.
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/corrections", (req, res) => {
    const status =
      req.query.status !== undefined ? Number(req.query.status) : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    if (status !== undefined && ![0, 1, 2].includes(status)) {
      res.status(400).json({ error: "status must be 0, 1, or 2" });
      return;
    }
    res.json({ corrections: listCorrections(status, limit) });
  });

  app.get("/corrections/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 0) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const row = getCorrection(id);
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(row);
  });

  app.get("/contributors/:address", async (req, res) => {
    try {
      const address = req.params.address;
      const [reputation, corrections] = await Promise.all([
        registry.reputation(address),
        Promise.resolve(contributorRows(address)),
      ]);
      res.json({ address, reputation, corrections });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/stats", async (_req, res) => {
    try {
      const local = stats();
      const [pool, totalPaid] = rewards
        ? await Promise.all([rewards.pool(), rewards.totalPaid()])
        : [0n, 0n];
      res.json({
        ...local,
        pool: pool.toString(),
        totalPaid: totalPaid.toString(),
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.listen(port, () => logger.info({ port }, "indexer API listening"));
}
