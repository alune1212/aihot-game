import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "loadouts",
  pages: [
    { path: "loadouts", file: "web/page.tsx" },
    { path: "loadouts/:id", file: "web/detail.tsx" },
  ],
  apiPaths: [/^\/api\/loadouts$/, /^\/api\/loadouts\/\d+$/],
});
