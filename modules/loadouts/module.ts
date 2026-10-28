import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "loadouts",
  pages: [{ path: "loadouts", file: "web/page.tsx" }],
  apiPaths: [/^\/api\/loadouts$/],
});
