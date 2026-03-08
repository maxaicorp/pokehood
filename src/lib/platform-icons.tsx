import { ReactNode } from "react";
import {
  SiEbay,
  SiInstagram,
  SiDiscord,
  SiYoutube,
  SiTwitch,
  SiTiktok,
  SiX,
  SiFacebook,
  SiReddit,
  SiEtsy,
  SiShopify,
  SiPaypal,
  SiWhatsapp,
  SiTelegram,
  
  SiGithub,
  SiPatreon,
  SiKickstarter,
} from "react-icons/si";
import { Globe } from "lucide-react";

interface PlatformInfo {
  icon: ReactNode;
  color: string; // brand color for optional tinting
  name: string;
}

const PLATFORM_MAP: Record<string, PlatformInfo> = {
  ebay: { icon: <SiEbay />, color: "#E53238", name: "eBay" },
  instagram: { icon: <SiInstagram />, color: "#E4405F", name: "Instagram" },
  discord: { icon: <SiDiscord />, color: "#5865F2", name: "Discord" },
  youtube: { icon: <SiYoutube />, color: "#FF0000", name: "YouTube" },
  twitch: { icon: <SiTwitch />, color: "#9146FF", name: "Twitch" },
  tiktok: { icon: <SiTiktok />, color: "#000000", name: "TikTok" },
  twitter: { icon: <SiX />, color: "#000000", name: "X (Twitter)" },
  "x.com": { icon: <SiX />, color: "#000000", name: "X" },
  facebook: { icon: <SiFacebook />, color: "#1877F2", name: "Facebook" },
  reddit: { icon: <SiReddit />, color: "#FF4500", name: "Reddit" },
  etsy: { icon: <SiEtsy />, color: "#F56400", name: "Etsy" },
  shopify: { icon: <SiShopify />, color: "#7AB55C", name: "Shopify" },
  paypal: { icon: <SiPaypal />, color: "#003087", name: "PayPal" },
  whatsapp: { icon: <SiWhatsapp />, color: "#25D366", name: "WhatsApp" },
  telegram: { icon: <SiTelegram />, color: "#26A5E4", name: "Telegram" },
  linkedin: { icon: <SiGithub />, color: "#0A66C2", name: "LinkedIn" },
  github: { icon: <SiGithub />, color: "#181717", name: "GitHub" },
  patreon: { icon: <SiPatreon />, color: "#FF424D", name: "Patreon" },
  kickstarter: { icon: <SiKickstarter />, color: "#05CE78", name: "Kickstarter" },
  tcgplayer: { icon: <Globe />, color: "#1D4ED8", name: "TCGPlayer" },
};

/**
 * Detect a platform from a label or URL string.
 * Returns the brand icon element or a generic globe icon.
 */
export function getPlatformIcon(labelOrUrl: string, className?: string): ReactNode {
  const lower = labelOrUrl.toLowerCase();
  for (const [key, info] of Object.entries(PLATFORM_MAP)) {
    if (lower.includes(key)) {
      return <span className={className} style={{ color: info.color, display: "inline-flex" }}>{info.icon}</span>;
    }
  }
  return <Globe className={className} />;
}

/**
 * Get platform info (icon, color, name) or null if not detected.
 */
export function detectPlatform(labelOrUrl: string): PlatformInfo | null {
  const lower = labelOrUrl.toLowerCase();
  for (const [key, info] of Object.entries(PLATFORM_MAP)) {
    if (lower.includes(key)) return info;
  }
  return null;
}
