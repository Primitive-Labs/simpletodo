import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Detects if the current browser is running on iOS/iPadOS.
 * Returns true for Safari, Chrome, Firefox, and other browsers on iOS.
 * Returns false for macOS Safari and other desktop browsers.
 */
export function isIOS(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const ua = navigator.userAgent;

  // Check for iOS/iPadOS
  // - Direct match for iPhone/iPad/iPod in user agent
  // - iPadOS 13+ reports as "MacIntel" but has touch support
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
