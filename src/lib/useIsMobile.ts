import { useCallback, useEffect, useState } from "react";

/**
 * Returns true when the device is likely a touchscreen phone/tablet:
 *   - coarse pointer (matchMedia) AND navigator.maxTouchPoints > 0
 *   - OR UA fallback for older browsers that don't expose pointer media
 */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const hasCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const hasTouchPoints = navigator.maxTouchPoints > 0;
  if (hasCoarsePointer && hasTouchPoints) return true;
  // UA fallback
  return /Mobi|Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent);
}

/**
 * True when the app runs as an installed standalone PWA (added to the home
 * screen) rather than inside a browser tab. iOS exposes navigator.standalone;
 * everyone else exposes the display-mode media query.
 */
export function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  const displayMode =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches;
  return iosStandalone || displayMode;
}

/** iOS (iPhone/iPad) detection for tailored install instructions. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.platform))
  );
}

/**
 * React hook that returns true on mobile and re-checks on resize /
 * orientationchange (handles split-screen, dev-tools mobile emulation, etc.).
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(() => isMobileDevice());

  const update = useCallback(() => {
    setMobile(isMobileDevice());
  }, []);

  // Debounced: resize/orientationchange burst on mobile; coalesce so the
  // device re-check (and its re-render) runs once after the gesture settles.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      if (t) clearTimeout(t);
      t = setTimeout(update, 120);
    };
    window.addEventListener("resize", onChange, { passive: true });
    window.addEventListener("orientationchange", onChange, { passive: true });
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, [update]);

  return mobile;
}
