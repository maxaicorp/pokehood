import { toast } from "sonner";
import type { NavigateFunction } from "react-router-dom";

/**
 * Success toast for adding an item (card or sealed product) to the user's
 * inventory, with a one-tap link to the inventory (the dashboard). Shared so
 * every add flow — CardDetail, SealedDetail, the Sealed tab — behaves the same.
 */
export function toastAddedToInventory(name: string, navigate: NavigateFunction) {
  toast.success(`${name} added to your inventory`, {
    action: {
      label: "View inventory",
      onClick: () => navigate("/dashboard?tab=collection"),
    },
    duration: 5000,
  });
}
