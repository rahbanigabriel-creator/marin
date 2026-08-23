import { rmSync } from "node:fs";
import { resolve } from "node:path";

rmSync(resolve(process.cwd(), ".next-quality"), { recursive: true, force: true });
