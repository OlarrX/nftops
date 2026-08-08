/**
 * RPC Pool Manager
 *
 * Manages multiple RPC endpoints per chain with:
 *  - Health checks (latency measurement)
 *  - Automatic failover to fastest healthy endpoint
 *  - Periodic re-evaluation of endpoint performance
 *
 * Usage:
 *   const pool = new RpcPool(chainKey, rpcUrls);
 *   const bestRpc = await pool.getFastestHealthyRpc();
 *   const provider = new ethers.JsonRpcProvider(bestRpc);
 */

import { ethers } from "ethers";

export interface RpcEndpoint {
  url: string;
  latencyMs: number | null; // null = not yet checked or unhealthy
  lastChecked: number; // timestamp
  consecutiveFailures: number;
}

export class RpcPool {
  private endpoints: RpcEndpoint[];
  private chainKey: string;
  private readonly maxFailures = 3; // mark unhealthy after this many failures
  private readonly recheckIntervalMs = 30000; // re-test endpoints every 30s

  constructor(chainKey: string, rpcUrls: string[]) {
    this.chainKey = chainKey;
    this.endpoints = rpcUrls.map((url) => ({
      url,
      latencyMs: null,
      lastChecked: 0,
      consecutiveFailures: 0,
    }));
  }

  /**
   * Get the fastest healthy RPC endpoint.
   * Runs health checks if needed, then returns the URL with lowest latency.
   */
  async getFastestHealthyRpc(): Promise<string> {
    // Check which endpoints need testing
    const now = Date.now();
    const needsCheck = this.endpoints.filter(
      (ep) =>
        ep.lastChecked === 0 ||
        now - ep.lastChecked > this.recheckIntervalMs ||
        ep.consecutiveFailures > 0
    );

    if (needsCheck.length > 0) {
      await this.checkEndpoints(needsCheck);
    }

    // Sort by latency (healthy first, then fastest)
    const healthy = this.endpoints
      .filter((ep) => ep.latencyMs !== null && ep.consecutiveFailures < this.maxFailures)
      .sort((a, b) => a.latencyMs! - b.latencyMs!);

    if (healthy.length === 0) {
      // All endpoints failed — return first one anyway and let caller handle the error
      console.warn(`[RpcPool/${this.chainKey}] All endpoints unhealthy, using first as fallback`);
      return this.endpoints[0].url;
    }

    const best = healthy[0];
    console.log(
      `[RpcPool/${this.chainKey}] Selected: ${this.shortenUrl(best.url)} (${best.latencyMs}ms)`
    );
    return best.url;
  }

  /**
   * Test a batch of endpoints in parallel, measure latency.
   */
  private async checkEndpoints(endpoints: RpcEndpoint[]): Promise<void> {
    const results = await Promise.allSettled(
      endpoints.map((ep) => this.pingEndpoint(ep.url))
    );

    results.forEach((result, i) => {
      const ep = endpoints[i];
      if (result.status === "fulfilled") {
        ep.latencyMs = result.value;
        ep.lastChecked = Date.now();
        ep.consecutiveFailures = 0;
      } else {
        ep.latencyMs = null;
        ep.lastChecked = Date.now();
        ep.consecutiveFailures++;
        console.warn(
          `[RpcPool/${this.chainKey}] ${this.shortenUrl(ep.url)} failed (${ep.consecutiveFailures}/${this.maxFailures})`
        );
      }
    });
  }

  /**
   * Ping a single RPC endpoint by calling eth_blockNumber.
   * Returns latency in milliseconds, or throws if unreachable.
   */
  private async pingEndpoint(url: string): Promise<number> {
    const provider = new ethers.JsonRpcProvider(url, undefined, {
      staticNetwork: true, // skip initial network detection for speed
    });

    const start = Date.now();
    await provider.getBlockNumber(); // lightweight call
    const latency = Date.now() - start;

    provider.destroy(); // clean up connection
    return latency;
  }

  /**
   * Shorten RPC URL for logging (remove query params, keep domain).
   */
  private shortenUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.hostname;
    } catch {
      return url.slice(0, 30);
    }
  }

  /**
   * Force re-check all endpoints (useful before a critical mint).
   */
  async refreshAll(): Promise<void> {
    console.log(`[RpcPool/${this.chainKey}] Force refreshing all endpoints...`);
    await this.checkEndpoints(this.endpoints);
  }

  /**
   * Get current endpoint status (for debugging/display).
   */
  getStatus(): Array<{ url: string; latencyMs: number | null; healthy: boolean }> {
    return this.endpoints.map((ep) => ({
      url: ep.url,
      latencyMs: ep.latencyMs,
      healthy: ep.consecutiveFailures < this.maxFailures && ep.latencyMs !== null,
    }));
  }
}

/**
 * Create an RPC pool from a chain preset + optional extra URLs.
 * Combines the preset's default RPC with user-supplied backups.
 */
export function createRpcPoolForChain(
  chainKey: string,
  presetRpcUrl: string,
  additionalRpcs: string[] = []
): RpcPool {
  const allRpcs = [presetRpcUrl, ...additionalRpcs].filter(
    (url, i, arr) => url && arr.indexOf(url) === i // dedupe
  );
  return new RpcPool(chainKey, allRpcs);
}
