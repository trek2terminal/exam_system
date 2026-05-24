import { useEffect, useState } from "react";
import { cn } from "./utils";

const sizeClasses = {
  sm: "h-10 w-10 text-base",
  md: "h-11 w-11 text-lg",
  lg: "h-12 w-12 text-xl",
};

export function PlatformLogo({
  src,
  name = "Exam Platform",
  size = "md",
  rounded = "lg",
  className = "",
  imageClassName = "",
  fallbackClassName = "",
  icon
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name || "Exam Platform").trim().charAt(0).toUpperCase() || "E";
  const roundedClass = rounded === "full" ? "rounded-full" : "rounded-lg";
  const dimensions = sizeClasses[size] || sizeClasses.md;

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <span
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden border border-border bg-background-base shadow-sm",
          dimensions,
          roundedClass,
          className
        )}
      >
        <img
          src={src}
          alt={`${name || "Platform"} logo`}
          className={cn("h-full w-full max-h-12 max-w-12 object-contain p-1", imageClassName)}
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-brand-primary font-bold text-white shadow-sm",
        dimensions,
        roundedClass,
        className,
        fallbackClassName
      )}
      aria-label={`${name || "Platform"} logo fallback`}
    >
      {icon || initial}
    </span>
  );
}
