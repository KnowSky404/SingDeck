import { Layers3 } from "lucide-react";
import { AboutDialog } from "./about-dialog";

export function Brand() {
  return (
    <div className="brand-cluster">
      <a className="brand" href="#/" aria-label="SingDeck overview">
        <span className="brand-mark">
          <Layers3 />
        </span>
        <span>SingDeck</span>
      </a>
      <AboutDialog />
    </div>
  );
}
