import { X } from "lucide-react";
import { Button } from "../ui";
import { Sidebar } from "./Sidebar";

export function MobileDrawer({ open, onClose, auth, platformName }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button className="absolute inset-0 bg-black/50 animate-page-fade" type="button" aria-label="Close menu" onClick={onClose} />
      <div className="relative h-full w-72 animate-drawer-left bg-background-base shadow-elevated">
        <Button variant="ghost" className="absolute right-3 top-3 z-10 h-11 w-11 px-0" onClick={onClose} aria-label="Close menu">
          <X size={20} />
        </Button>
        <Sidebar auth={auth} platformName={platformName} mobile onNavigate={onClose} />
      </div>
    </div>
  );
}
