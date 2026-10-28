import type { ReactNode } from "react";
import { defineWebModule } from "@aihot/web/modules";

function IconLoadout({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5" />
    </svg>
  );
}

const item = { to: "/loadouts", label: "改枪码", icon: IconLoadout };

export default defineWebModule({
  name: "loadouts",
  sidebar: { section: "改枪", items: [item] },
  tabs: [{ key: "loadouts", to: "/loadouts", label: "改枪", icon: IconLoadout }],
  tools: [{ to: "/loadouts", label: "改枪码", icon: IconLoadout({}) as ReactNode }],
});
