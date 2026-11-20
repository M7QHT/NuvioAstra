import { useEffect, useRef, useState } from "react";

/** True once the element has come within `margin` of the viewport (stays true). */
export function useInView<T extends Element>(margin = "400px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [margin, seen]);
  return [ref, seen] as const;
}

/** Calls `onVisible` whenever the element is within `margin` of the viewport; the check is redone
 *  when `deps` change (e.g. after a page was appended), so a sentinel still on screen loads on. */
export function useWhenVisible<T extends Element>(onVisible: () => void, deps: unknown[], margin = "400px") {
  const ref = useRef<T>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) callback.current();
    }, { rootMargin: margin });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [margin, ...deps]);
  return ref;
}
