import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { submitGiveawayEntry } from "@/lib/giveaway-store";
import { CheckCircle2, AlertTriangle } from "lucide-react";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR",
  "PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  giveawayId: string;
  giveawayTitle: string;
}

type SubmitState =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "success"; emailSent: boolean; message: string }
  | { kind: "error"; message: string };

export default function GiveawayEntryForm({ open, onOpenChange, giveawayId, giveawayTitle }: Props) {
  const isMobile = useIsMobile();
  const [state, setState] = useState<SubmitState>({ kind: "form" });

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zip, setZip] = useState("");

  const reset = () => {
    setFullName(""); setEmail(""); setStreet(""); setCity(""); setStateCode(""); setZip("");
    setState({ kind: "form" });
  };

  const handleClose = (next: boolean) => {
    if (state.kind === "submitting") return;
    onOpenChange(next);
    if (!next) {
      // Defer reset so the closing animation doesn't flash empty fields
      setTimeout(reset, 250);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ kind: "submitting" });
    const res = await submitGiveawayEntry({
      giveaway_id: giveawayId,
      full_name: fullName.trim(),
      email: email.trim(),
      street_address: street.trim(),
      city: city.trim(),
      state: stateCode,
      zip: zip.trim(),
    });
    if (res.ok) {
      setState({
        kind: "success",
        emailSent: !!res.email_sent,
        message: res.message ?? "Entry received.",
      });
    } else {
      setState({ kind: "error", message: res.error ?? "Something went wrong" });
    }
  };

  const Body = () => {
    if (state.kind === "success") {
      return (
        <div className="px-1 sm:px-0 pb-4 sm:pb-0">
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            <p className="text-sm text-foreground max-w-sm">{state.message}</p>
            {!state.emailSent && (
              <p className="text-xs text-amber-500">
                Confirmation email could not be sent right now. Your info is saved — please contact support if you don't receive a follow-up.
              </p>
            )}
            <Button onClick={() => handleClose(false)} className="mt-2">Close</Button>
          </div>
        </div>
      );
    }

    return (
      <form onSubmit={onSubmit} className="space-y-4 px-1 sm:px-0 pb-4 sm:pb-0">
        <div className="space-y-1.5">
          <Label htmlFor="ge-name">Full name</Label>
          <Input id="ge-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ge-email">Email</Label>
          <Input id="ge-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ge-street">Street address</Label>
          <Input id="ge-street" required value={street} onChange={(e) => setStreet(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ge-city">City</Label>
            <Input id="ge-city" required value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ge-state">State</Label>
            <Select value={stateCode} onValueChange={setStateCode}>
              <SelectTrigger id="ge-state">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {US_STATES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ge-zip">ZIP code</Label>
          <Input id="ge-zip" required pattern="^\d{5}(-\d{4})?$" placeholder="12345" value={zip} onChange={(e) => setZip(e.target.value)} maxLength={10} />
        </div>

        <p className="text-xs text-muted-foreground border-t border-border/50 pt-3">
          We can only ship prizes within the United States. By submitting, you'll receive a confirmation email — your entry isn't final until you click the link.
        </p>

        {state.kind === "error" && (
          <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{state.message}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => handleClose(false)} disabled={state.kind === "submitting"}>
            Cancel
          </Button>
          <Button type="submit" disabled={state.kind === "submitting" || !stateCode}>
            {state.kind === "submitting" ? "Submitting…" : "Enter giveaway"}
          </Button>
        </div>
      </form>
    );
  };

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleClose}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>Enter the giveaway</DrawerTitle>
            <DrawerDescription className="line-clamp-2">{giveawayTitle}</DrawerDescription>
          </DrawerHeader>
          <div className="px-4">
            <Body />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enter the giveaway</DialogTitle>
          <DialogDescription className="line-clamp-2">{giveawayTitle}</DialogDescription>
        </DialogHeader>
        <Body />
      </DialogContent>
    </Dialog>
  );
}
