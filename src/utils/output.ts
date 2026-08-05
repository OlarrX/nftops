/**
 * Output utilities.
 *
 * Write results to JSON + console so the user can easily reuse addresses/tx hashes
 * without copying from terminal logs.
 */

import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(process.cwd(), "output");

// Ensure the output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

export interface OutputRecord {
  timestamp: string;
  flow: "mintEvm" | "mintSolana" | "deployEvm";
  chain?: string;
  result: Record<string, unknown>;
}

/**
 * Write a JSON file to the output/ folder and log the path + key data to console.
 * Returns the full path to the written file.
 */
export function writeOutput(filename: string, data: OutputRecord): string {
  const filePath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`\n✅ Result saved to: ${filePath}`);
  return filePath;
}

/**
 * Generate a timestamped filename for a given flow.
 * Example: "mintEvm_2024-08-03T12-34-56.json"
 */
export function generateFilename(flow: string): string {
  const ts = new Date().toISOString().replace(/:/g, "-").split(".")[0];
  return `${flow}_${ts}.json`;
}

/**
 * Log a success message with key details highlighted.
 */
export function logSuccess(message: string, details?: Record<string, string | number>) {
  console.log(`\n✅ ${message}`);
  if (details) {
    for (const [k, v] of Object.entries(details)) {
      console.log(`   ${k}: ${v}`);
    }
  }
}

/**
 * Log an error message.
 */
export function logError(message: string, error?: unknown) {
  console.error(`\n❌ ${message}`);
  if (error instanceof Error) {
    console.error(`   ${error.message}`);
  } else if (error) {
    console.error(`   ${String(error)}`);
  }
}
