import { useEffect, useRef, useState } from "react";
import { cn } from "./utils";

export function Tooltip({ label, children, className }) {
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const timeoutRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [coords, setCoords] = useState({ left: 0, top: 0 });

  const show = () => {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setPositioned(false);
      setVisible(true);
    }, 300);
  };

  const hide = () => {
    window.clearTimeout(timeoutRef.current);
    setVisible(false);
    setPositioned(false);
  };

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  useEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;

    const gap = 12;
    const viewportPadding = 8;
    const trigger = triggerRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = trigger.right + gap;
    let top = trigger.top + (trigger.height - tooltip.height) / 2;

    if (left + tooltip.width > viewportWidth - viewportPadding) {
      left = trigger.left - tooltip.width - gap;
    }

    if (top + tooltip.height > viewportHeight - viewportPadding) {
      top = trigger.top - tooltip.height - gap;
    }

    left = Math.min(Math.max(left, viewportPadding), viewportWidth - tooltip.width - viewportPadding);
    top = Math.min(Math.max(top, viewportPadding), viewportHeight - tooltip.height - viewportPadding);

    setCoords({ left, top });
    setPositioned(true);
  }, [visible, label]);

  return (
    <span
      className={cn("relative inline-flex", className)}
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && label && (
        <span
          ref={tooltipRef}
          className="pointer-events-none fixed z-50 max-w-[min(16rem,calc(100vw-1rem))] rounded-md tooltip-bg px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg transition-opacity duration-150"
          style={{ left: coords.left, top: coords.top, opacity: positioned ? 1 : 0 }}
          role="tooltip"
        >
          {label}
        </span>
      )}
    </span>
  );
}
