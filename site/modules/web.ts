// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import loadouts from "../../modules/loadouts/web.tsx";

export const WEB_MODULES: readonly WebModule[] = [loadouts];
