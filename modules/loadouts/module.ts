import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "loadouts",
  pages: [
    { path: "loadouts", file: "web/page.tsx" },
    { path: "loadouts/gun/:weapon", file: "web/gun.tsx", id: "loadouts-gun" },
    { path: "loadouts/:id", file: "web/detail.tsx" },
  ],
  apiPaths: [/^\/api\/loadouts$/, /^\/api\/loadouts\/gun\/[^/]+$/, /^\/api\/loadouts\/\d+$/],
});
