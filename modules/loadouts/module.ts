import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "loadouts",
  pages: [
    { path: "loadouts", file: "web/page.tsx" },
    { path: "loadouts/recommend", file: "web/recommend.tsx", id: "loadouts-recommend" },
    { path: "loadouts/gun/:weapon", file: "web/gun.tsx", id: "loadouts-gun" },
    { path: "loadouts/:id", file: "web/detail.tsx" },
  ],
  apiPaths: [/^\/api\/loadouts$/, /^\/api\/loadouts\/recommend$/, /^\/api\/loadouts\/gun\/[^/]+$/, /^\/api\/loadouts\/\d+$/, /^\/api\/loadouts\/\d+\/cost$/],
});
