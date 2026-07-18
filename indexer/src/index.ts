import { RegistryClient, RewardsClient } from "@danfo/sdk";
import { config, danfoConfig } from "./config";
import { logger } from "./logger";
import { startFinalizer } from "./finalizer";
import { startPoller } from "./poller";
import { startServer } from "./server";

const cfg = danfoConfig();
const registry = new RegistryClient(cfg);
const rewards = cfg.rewardsId ? new RewardsClient(cfg) : null;

logger.info(
  { registry: cfg.registryId, rewards: cfg.rewardsId || "(none)" },
  "danfo indexer starting"
);

startPoller(registry, config.pollMs);
startFinalizer(registry, rewards, config.crankMs);
startServer(registry, rewards, config.port);
