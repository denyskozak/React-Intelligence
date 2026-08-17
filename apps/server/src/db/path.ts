import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const defaultDbPath = fileURLToPath(new URL("../../../../data/react-intelligence.sqlite", import.meta.url));
export const configuredDbPath = resolve(process.env.REACT_INTELLIGENCE_DB ?? defaultDbPath);
